import { LAYOUT_WIDTH_OPTIONS, SETTINGS, exactMatches, freshTab, groupName, initialState, makeBackup, normalizeGroup, normalizeSettings, signature, urlOverlap, validateBackup } from './model'

export class TabEngine {
  constructor({ browser, database, onChange = () => {} }) {
    this.browser = browser
    this.database = database
    this.onChange = onChange
    this.creating = 0
    this.tail = Promise.resolve()
    this.ready = this.initialize()
  }

  async initialize() {
    this.state = await this.database.load() || initialState()
    this.state.groups = this.state.groups.map(normalizeGroup)
    this.state.settings = normalizeSettings(this.state.settings)
    this.state.suppressed ||= {}
    this.state.closingWindows ||= {}
    this.state.candidates ||= {}
    this.state.choices ||= {}
    this.state.reuseExemptTabs ||= {}
    const session = await this.browser.session()
    const recovery = !!this.state.session && this.state.session !== session
    this.startupUntil = recovery ? Date.now() + 15000 : 0
    if (recovery) {
      this.state.suppressed = {}
      this.state.closingWindows = {}
      this.state.candidates = {}
      this.state.choices = {}
      this.state.reuseExemptTabs = {}
    }
    this.state.session = session
    await this.sync(recovery)
  }

  enqueue(work) {
    const task = this.tail.catch(() => {}).then(async () => { await this.ready; return work() })
    this.tail = task
    return task
  }

  async save() {
    this.state.revision += 1
    await this.database.save(this.state)
    this.onChange()
  }

  snapshot() {
    return structuredClone({ ...this.state, groups: [...this.state.groups].sort((first, second) => Number(second.status === 'live') - Number(first.status === 'live') || Number(second.main) - Number(first.main) || first.order - second.order) })
  }

  archiveRecord(group) {
    return { ...group, status: 'archived', windowId: null, archivedAt: Date.now(), tabs: group.tabs.map(tab => ({ ...tab, chromeId: null, active: false, focused: false, assigned: true })) }
  }

  async sync(recovery = false) {
    const before = JSON.stringify([this.state.groups, this.state.suppressed, this.state.closingWindows, this.state.candidates, this.state.choices])
    const now = Date.now()
    for (const [id, deadline] of Object.entries(this.state.suppressed)) if (deadline < now) delete this.state.suppressed[id]
    for (const [id, deadline] of Object.entries(this.state.closingWindows)) if (deadline < now) delete this.state.closingWindows[id]
    for (const [id, candidate] of Object.entries(this.state.candidates)) if (candidate.expiresAt < now) delete this.state.candidates[id]
    for (const [token, choice] of Object.entries(this.state.choices)) if (choice.expiresAt < now) delete this.state.choices[token]
    for (const [id, deadline] of Object.entries(this.state.reuseExemptTabs)) if (deadline < now) delete this.state.reuseExemptTabs[id]
    const rawTabs = (await this.browser.listTabs()).filter(tab => !this.state.suppressed[tab.id] && !this.state.closingWindows[tab.windowId])
    const windows = new Map()
    for (const tab of rawTabs) {
      if (!windows.has(tab.windowId)) windows.set(tab.windowId, [])
      windows.get(tab.windowId).push(tab)
    }
    for (const tabs of windows.values()) tabs.sort((first, second) => first.index - second.index)
    const previous = this.state.groups.filter(group => group.status === 'live')
    const used = new Set()
    const groups = this.state.groups.filter(group => group.status === 'archived')
    for (const [windowId, tabs] of windows) {
      let old = previous.find(group => group.windowId === windowId)
      if (recovery) {
        const ranked = previous.filter(group => !used.has(group.id)).map(group => ({
          group, exact: signature(group.tabs) === signature(tabs), ...urlOverlap(group.tabs, tabs),
        })).filter(match => match.exact || (match.shared >= 2 && match.score >= 0.8))
          .sort((first, second) => Number(second.exact) - Number(first.exact) || second.score - first.score)
        old = ranked.length && (ranked.length === 1 || (ranked[0].exact && !ranked[1].exact)
          || ranked[0].score - ranked[1].score >= 0.15) ? ranked[0].group : null
      }
      if (old) used.add(old.id)
      const aliases = new Map()
      if (recovery && old) for (const tab of old.tabs) {
        if (!aliases.has(tab.url)) aliases.set(tab.url, [])
        aliases.get(tab.url).push(tab)
      }
      const current = {
        ...old,
        id: old?.id || crypto.randomUUID(), name: old?.name || '', status: 'live', windowId,
        hibernate: old?.hibernate || false, main: old?.main || false, order: old?.order ?? groups.length,
        tabs: tabs.map(tab => freshTab(tab, recovery ? aliases.get(tab.url)?.shift() : previous.flatMap(group => group.tabs).find(item => item.chromeId === tab.id))),
      }
      if (recovery && old) {
        current.retainedTabs = [
          ...(old.retainedTabs || []),
          ...[...aliases.values()].flat().map(tab => ({ ...tab, chromeId: null, active: false, focused: false })),
        ]
      }
      groups.push(current)
    }
    const currentIds = new Set(rawTabs.map(tab => tab.id))
    for (const group of previous) {
      if (used.has(group.id) || !group.tabs.length) continue
      if (!recovery && windows.has(group.windowId)) continue
      if (!recovery && group.tabs.some(tab => currentIds.has(tab.chromeId))) continue
      groups.push(this.archiveRecord(group))
    }
    this.state.groups = groups
    const after = JSON.stringify([this.state.groups, this.state.suppressed, this.state.closingWindows, this.state.candidates, this.state.choices])
    if (before !== after) await this.save()
    return this.snapshot()
  }

  group(id) {
    const group = this.state.groups.find(item => item.id === id)
    if (!group) throw new Error('This group no longer exists.')
    return group
  }

  locate(id) {
    for (const group of this.state.groups) {
      const tab = group.tabs.find(item => item.id === id)
      if (tab) return { group, tab }
    }
    throw new Error('This tab no longer exists.')
  }

  suppress(tab) {
    if (tab.chromeId !== null) {
      this.state.suppressed[tab.chromeId] = Date.now() + 60000
      delete this.state.candidates[tab.chromeId]
    }
  }

  exemptCreatedTab(id) {
    this.state.reuseExemptTabs[id] = Date.now() + 300000
    delete this.state.candidates[id]
  }

  prune(group, ids) {
    group.tabs = group.tabs.filter(tab => !ids.includes(tab.id))
    if (!group.tabs.length) this.state.groups = this.state.groups.filter(item => item.id !== group.id)
  }

  async closeTab(id) {
    const { group, tab } = this.locate(id)
    if (group.status === 'live') {
      await this.browser.closeTab(tab.chromeId)
      this.suppress(tab)
    }
    this.prune(group, [id])
    await this.save()
  }

  async archiveGroup(id) {
    const group = this.group(id)
    if (group.status !== 'live') return
    await this.sync()
    const current = this.group(id)
    const archived = this.archiveRecord(current)
    this.state.groups = this.state.groups.map(item => item.id === id ? archived : item)
    await this.save()
    try {
      await this.browser.closeWindow(current.windowId)
      current.tabs.forEach(tab => this.suppress(tab))
      await this.save()
    } catch (error) {
      this.state.groups = this.state.groups.map(item => item.id === id ? current : item)
      await this.save()
      throw error
    }
  }

  async restoreGroup(id, targetId) {
    const group = this.group(id)
    if (group.status === 'live') {
      await this.browser.activate((group.tabs.find(tab => tab.id === targetId) || group.tabs[0]).chromeId)
      return
    }
    if (!group.tabs.length) throw new Error('This archive is empty.')
    this.creating += 1
    try {
      const restored = await this.browser.restore(group.tabs, targetId)
      if (!restored.windowId || !Array.isArray(restored.rows) || restored.rows.length !== group.tabs.length
        || new Set(restored.rows.map(row => row.savedId)).size !== group.tabs.length
        || new Set(restored.rows.map(row => row.tab?.id)).size !== group.tabs.length
        || !restored.rows.every(row => row.tab?.id && group.tabs.some(tab => tab.id === row.savedId))) {
        throw new Error('Chrome did not restore every tab. Your archive was kept.')
      }
      restored.rows.forEach(row => this.exemptCreatedTab(row.tab.id))
      this.state.groups = this.state.groups.map(item => item.id === id ? {
        ...group, status: 'live', windowId: restored.windowId,
        tabs: restored.rows.map(row => freshTab(row.tab, { ...group.tabs.find(tab => tab.id === row.savedId), assigned: true })),
      } : item)
      await this.save()
    } finally { this.creating -= 1 }
  }

  async removeGroup(id) {
    const group = this.group(id)
    if (group.status === 'live') {
      await this.browser.closeWindow(group.windowId)
      group.tabs.forEach(tab => this.suppress(tab))
    }
    this.state.groups = this.state.groups.filter(item => item.id !== id)
    await this.save()
  }

  async transfer(ids, targetId) {
    const target = this.group(targetId)
    for (const id of [...new Set(ids)]) {
      const { group, tab } = this.locate(id)
      if (group.id === target.id) { tab.assigned = true; continue }
      if (target.status === 'archived') {
        if (!target.tabs.some(item => item.sourceId === tab.id)) target.tabs.push({ ...tab, id: crypto.randomUUID(), sourceId: tab.id, chromeId: null, active: false, focused: false, assigned: true })
        await this.save()
        if (group.status === 'live') {
          await this.browser.closeTab(tab.chromeId)
          this.suppress(tab)
        }
      } else if (group.status === 'live') {
        await this.browser.moveTab(tab.chromeId, target.windowId)
        target.tabs.push({ ...tab, assigned: true })
      } else {
        this.creating += 1
        try {
          const created = await this.browser.createTab(target.windowId, tab)
          this.exemptCreatedTab(created.id)
          target.tabs.push(freshTab(created, { ...tab, assigned: true }))
        } finally { this.creating -= 1 }
      }
      this.prune(group, [id])
      await this.save()
    }
    await this.save()
    await this.sync()
  }

  async assignCurrent(ids) {
    for (const id of ids) this.locate(id).tab.assigned = true
    await this.save()
  }

  async reorderTabs(groupId, ids) {
    const group = this.group(groupId)
    if (ids.length !== group.tabs.length || new Set(ids).size !== ids.length || ids.some(id => !group.tabs.some(tab => tab.id === id))) throw new Error('Tab order is out of date. Refresh and try again.')
    const ordered = ids.map(id => group.tabs.find(tab => tab.id === id))
    if (group.status === 'live') {
      const pinned = ordered.filter(tab => tab.pinned)
      const normal = ordered.filter(tab => !tab.pinned)
      await this.browser.reorderTabs([...pinned, ...normal].map(tab => tab.chromeId))
      group.tabs = [...pinned, ...normal]
    } else group.tabs = ordered
    await this.save()
  }

  reuseAllowed(url) {
    const settings = this.state.settings
    if (!settings.reuseEnabled || settings.pausedUntil > Date.now() || Date.now() < this.startupUntil || !/^https?:\/\//.test(url)) return false
    try {
      const host = new URL(url).hostname
      return !settings.excludedHosts.some(excluded => host === excluded || host.endsWith(`.${excluded}`))
    } catch { return false }
  }

  async sourceMatches(chromeId, url) {
    try {
      const tab = await this.browser.getTab(chromeId)
      return this.reuseAllowed(url) && !tab.incognito && !tab.pinned && tab.url === url && (!tab.pendingUrl || tab.pendingUrl === url)
    } catch { return false }
  }

  async focusMatch(source, url) {
    const candidate = this.state.candidates[source.id]
    const matching = (await this.browser.listTabs()).filter(tab => {
      const other = this.state.candidates[tab.id]
      return tab.id !== source.id && !tab.incognito && tab.url === url && (!tab.pendingUrl || tab.pendingUrl === url)
        && (!candidate || !other || other.createdAt < candidate.createdAt || (other.createdAt === candidate.createdAt && tab.id < source.id))
    }).sort((first, second) => Number(second.windowId === source.windowId) - Number(first.windowId === source.windowId) || (second.lastAccessed || 0) - (first.lastAccessed || 0) || first.id - second.id)
    if (!matching.length || !await this.sourceMatches(source.id, url)) return false
    await this.browser.activate(matching[0].id)
    if (await this.sourceMatches(source.id, url)) await this.closeSource(source.id)
    return true
  }

  async closeSource(chromeId) {
    await this.browser.closeTab(chromeId)
    this.state.suppressed[chromeId] = Date.now() + 60000
    delete this.state.candidates[chromeId]
    const group = this.state.groups.find(item => item.status === 'live' && item.tabs.some(tab => tab.chromeId === chromeId))
    if (group) this.prune(group, group.tabs.filter(tab => tab.chromeId === chromeId).map(tab => tab.id))
    await this.save()
  }

  async reuseNewTab(chromeId) {
    const candidate = this.state.candidates[chromeId]
    if (!candidate) return
    if (candidate.expiresAt < Date.now() || candidate.consumed || this.state.reuseExemptTabs[chromeId] > Date.now()) {
      delete this.state.candidates[chromeId]
      await this.save()
      return
    }
    const source = await this.browser.getTab(chromeId)
    if (source.status !== 'complete') return
    const url = source.url
    if (!/^https?:\/\//.test(url || '') || (source.pendingUrl && source.pendingUrl !== url)) return
    if (!await this.sourceMatches(chromeId, url)) { delete this.state.candidates[chromeId]; await this.save(); return }
    if (this.state.settings.skipNext) {
      this.state.settings.skipNext = false
      delete this.state.candidates[chromeId]
      await this.save()
      return
    }
    candidate.consumed = true
    await this.save()
    if (await this.focusMatch(source, url)) return
    const matches = exactMatches(this.state.groups.filter(group => group.status === 'archived'), url)
    if (matches.length === 1) {
      await this.restoreGroup(matches[0].groupId, matches[0].tabId)
      if (await this.sourceMatches(chromeId, url)) await this.closeSource(chromeId)
    } else if (matches.length > 1) {
      if (Object.values(this.state.choices).some(choice => choice.chromeId === chromeId)) return
      const token = crypto.randomUUID()
      this.state.choices[token] = { chromeId, url, matches, expiresAt: Date.now() + 300000 }
      await this.save()
      await this.browser.showChooser(token)
    }
    delete this.state.candidates[chromeId]
    await this.save()
  }

  async choose(token, groupId) {
    const choice = this.state.choices[token]
    if (!choice || choice.expiresAt < Date.now()) throw new Error('This choice expired. Your new tab was kept.')
    if (groupId) {
      if (!await this.sourceMatches(choice.chromeId, choice.url)) throw new Error('The new tab changed. It was not closed.')
      const match = choice.matches.find(item => item.groupId === groupId)
      if (!match || !this.group(groupId).tabs.some(tab => tab.id === match.tabId && tab.url === choice.url)) throw new Error('The archived target no longer matches.')
      if (!await this.focusMatch(await this.browser.getTab(choice.chromeId), choice.url)) {
        await this.restoreGroup(groupId, match.tabId)
        if (await this.sourceMatches(choice.chromeId, choice.url)) await this.closeSource(choice.chromeId)
      }
    }
    delete this.state.choices[token]
    await this.save()
  }

  event(type, payload) {
    return this.enqueue(async () => {
      if (type === 'removed') {
        const group = this.state.groups.find(item => item.status === 'live' && item.tabs.some(tab => tab.chromeId === payload.id))
        delete this.state.candidates[payload.id]
        if (group && payload.windowClosing) this.state.closingWindows[group.windowId] = Date.now() + 60000
        if (group && !payload.windowClosing) this.prune(group, group.tabs.filter(tab => tab.chromeId === payload.id).map(tab => tab.id))
        await this.save()
        return
      }
      await this.sync()
      if (type === 'created' && !payload.managed && !payload.tab.incognito && !payload.tab.discarded
        && !(this.state.reuseExemptTabs[payload.tab.id] > Date.now())
        && this.state.settings.reuseEnabled && Date.now() >= this.startupUntil) {
        this.state.candidates[payload.tab.id] = { createdAt: payload.createdAt, expiresAt: payload.createdAt + 60000 }
        await this.save()
      }
    })
  }

  request(type, payload = {}) {
    return this.enqueue(async () => {
      switch (type) {
        case 'snapshot': return this.sync()
        case 'activate': {
          const { group, tab } = this.locate(payload.tabId)
          if (group.status === 'archived') await this.restoreGroup(group.id, tab.id)
          else await this.browser.activate(tab.chromeId)
          break
        }
        case 'close': for (const id of payload.tabIds) await this.closeTab(id); break
        case 'archive': await this.archiveGroup(payload.groupId); break
        case 'restore': await this.restoreGroup(payload.groupId, payload.tabId); break
        case 'delete': await this.removeGroup(payload.groupId); break
        case 'transfer': await this.transfer(payload.tabIds, payload.groupId); break
        case 'assign': await this.assignCurrent(payload.tabIds); break
        case 'renameGroup': this.group(payload.groupId).name = String(payload.name).trim().slice(0, 160); await this.save(); break
        case 'renameTab': this.locate(payload.tabId).tab.name = String(payload.name).trim().slice(0, 160); await this.save(); break
        case 'hibernate': this.group(payload.groupId).hibernate = !!payload.value; await this.save(); break
        case 'main': for (const group of this.state.groups) group.main = group.id === payload.groupId ? !!payload.value : false; await this.save(); break
        case 'reorderGroups': {
          if (payload.ids.some(id => !this.state.groups.some(group => group.id === id))) throw new Error('Group order is out of date.')
          payload.ids.forEach((id, index) => { this.group(id).order = index })
          await this.save()
          break
        }
        case 'reorderTabs': await this.reorderTabs(payload.groupId, payload.ids); break
        case 'settings': {
          for (const [key, value] of Object.entries(payload)) if (Object.hasOwn(SETTINGS, key)) this.state.settings[key] = value
          if (!Object.hasOwn(payload, 'layoutMode') && Object.keys(LAYOUT_WIDTH_OPTIONS).some(key => Object.hasOwn(payload, key))) this.state.settings.layoutMode = 'manual'
          this.state.settings = normalizeSettings(this.state.settings)
          if (!this.state.settings.reuseEnabled || this.state.settings.pausedUntil > Date.now()) this.state.candidates = {}
          await this.save()
          break
        }
        case 'backup': return makeBackup(this.state)
        case 'import': {
          const groups = validateBackup(payload.backup)
          groups.forEach((group, index) => { group.order = this.state.groups.length + index })
          this.state.groups.push(...groups)
          await this.save()
          return { imported: groups.length }
        }
        case 'reuse': await this.reuseNewTab(payload.chromeId); break
        case 'choice': return structuredClone(this.state.choices[payload.token] || null)
        case 'choose': await this.choose(payload.token, payload.groupId); break
        default: throw new Error(`Unknown operation: ${type}`)
      }
      return this.snapshot()
    })
  }
}
