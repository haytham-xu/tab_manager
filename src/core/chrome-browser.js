export function chromeBrowser(api = chrome) {
  return {
    async session() {
      const stored = await api.storage.session.get('browserSession')
      const id = stored.browserSession || crypto.randomUUID()
      if (!stored.browserSession) await api.storage.session.set({ browserSession: id })
      return id
    },
    async listTabs() {
      const internal = api.runtime.getURL('')
      const focusedWindows = new Set((await api.windows.getAll()).filter(window => window.focused).map(window => window.id))
      return (await api.tabs.query({})).filter(tab => !tab.incognito && tab.windowId > 0 && !(tab.url || tab.pendingUrl || '').startsWith(internal))
        .map(tab => ({ ...tab, focused: !!tab.active && focusedWindows.has(tab.windowId) }))
    },
    getTab: id => api.tabs.get(id),
    async activate(id) {
      const tab = await api.tabs.get(id)
      await api.tabs.update(id, { active: true })
      const window = await api.windows.get(tab.windowId)
      await api.windows.update(tab.windowId, window.state === 'minimized' ? { state: 'normal', focused: true } : { focused: true })
    },
    closeTab: id => api.tabs.remove(id),
    closeWindow: id => api.windows.remove(id),
    moveTab: (id, windowId, index = -1) => api.tabs.move(id, { windowId, index }),
    async reorderTabs(ids) {
      for (const [index, id] of ids.entries()) await api.tabs.move(id, { index })
    },
    async createTab(windowId, tab) {
      return api.tabs.create({ windowId, url: tab.url, pinned: !!tab.pinned, active: false })
    },
    async restore(tabs, targetId) {
      let created
      try {
        created = await api.windows.create({ url: tabs[0].url, focused: false })
        if (!created?.tabs?.[0]?.id) throw new Error('Chrome did not create the target window.')
        const first = created.tabs[0]
        if (tabs[0].pinned) await api.tabs.update(first.id, { pinned: true })
        const rows = [{ savedId: tabs[0].id, tab: { ...first, url: tabs[0].url, pinned: tabs[0].pinned } }]
        for (const tab of tabs.slice(1)) rows.push({ savedId: tab.id, tab: await api.tabs.create({ windowId: created.id, url: tab.url, pinned: !!tab.pinned, active: false }) })
        const target = rows.find(row => row.savedId === targetId) || rows[0]
        await this.activate(target.tab.id)
        return { windowId: created.id, rows }
      } catch (error) {
        if (created?.id) await api.windows.remove(created.id).catch(() => {})
        throw error
      }
    },
    async showChooser(token) {
      await api.windows.create({ url: `${api.runtime.getURL('chooser.html')}?choice=${encodeURIComponent(token)}`, type: 'popup', width: 540, height: 480 })
    },
  }
}