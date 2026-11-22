export const SETTINGS = {
  sandboxVisible: true,
  followActive: true,
  reuseEnabled: true,
  pausedUntil: 0,
  skipNext: false,
  excludedHosts: [],
  collapsedGroups: [],
}

export function initialState() {
  return { version: 1, revision: 0, session: '', groups: [], settings: structuredClone(SETTINGS), candidates: {}, choices: {} }
}

export function exactMatches(groups, url) {
  return groups.flatMap(group => {
    const tab = group.tabs.find(item => item.url === url)
    return tab ? [{ groupId: group.id, tabId: tab.id, name: group.name, count: group.tabs.length }] : []
  })
}

export function duplicateColors(groups) {
  const counts = new Map()
  for (const group of groups) for (const tab of group.tabs) counts.set(tab.url, (counts.get(tab.url) || 0) + 1)
  return new Map([...counts].filter(([url, count]) => url && count > 1).map(([url]) => url).sort().map((url, index) => [url, index % 6]))
}

export function validateBackup(value) {
  if (!value || value.format !== 'tab-manager-backup' || value.version !== 1 || !Array.isArray(value.groups)) {
    throw new Error('This is not a supported Tab Manager backup.')
  }
  if (value.groups.length > 10000) throw new Error('Backup contains too many groups.')
  let totalTabs = 0
  const groups = value.groups.map((group, index) => {
    if (!group || typeof group.name !== 'string' || !Array.isArray(group.tabs)) throw new Error(`Invalid group ${index + 1}.`)
    totalTabs += group.tabs.length
    if (totalTabs > 100000) throw new Error('Backup contains too many tabs.')
    return {
      id: crypto.randomUUID(), name: group.name.slice(0, 160), status: 'archived', windowId: null,
      hibernate: !!group.hibernate, main: false, order: index, archivedAt: Date.now(),
      tabs: group.tabs.map(tab => {
        if (!tab || typeof tab.url !== 'string' || !tab.url || tab.url.length > 100000) throw new Error('Invalid tab URL.')
        const protocol = new URL(tab.url).protocol
        if (!['http:', 'https:', 'file:', 'about:', 'chrome:'].includes(protocol)) throw new Error(`Unsupported URL scheme: ${protocol}`)
        return {
          id: crypto.randomUUID(), chromeId: null, url: tab.url,
          title: String(tab.title || '').slice(0, 1000), name: String(tab.name || '').slice(0, 160),
          favicon: '', pinned: !!tab.pinned, active: false, assigned: true,
        }
      }),
    }
  })
  return groups.filter(group => group.tabs.length)
}

export function makeBackup(state) {
  return {
    format: 'tab-manager-backup', version: 1, exportedAt: new Date().toISOString(),
    groups: state.groups.map(group => ({
      name: group.name, hibernate: group.hibernate,
      tabs: [...group.tabs, ...normalizeGroup(group).retainedTabs].map(({ url, title, name, pinned }) => ({ url, title, name, pinned })),
    })),
  }
}

export function normalizeGroup(group) {
  const result = { ...group, retainedTabs: [] }
  for (const [key, value] of Object.entries(group)) {
    if (key === 'tabs' || !Array.isArray(value)) continue
    if (key === 'retainedTabs' || (value.length > 0 && value.every(tab => tab && typeof tab.url === 'string'))) {
      result.retainedTabs.push(...value)
      if (key !== 'retainedTabs') delete result[key]
    }
  }
  return result
}

export function tabName(tab) { return tab.name || tab.title || tab.url || 'Untitled tab' }
export function groupName(group) { return group.name || (group.status === 'live' ? 'Untitled window' : 'Untitled archive') }

export function freshTab(tab, previous) {
  return {
    id: previous?.id || crypto.randomUUID(), chromeId: tab.id, url: tab.url || tab.pendingUrl || '',
    title: tab.title || '', name: previous?.name || '', favicon: tab.favIconUrl || '',
    pinned: !!tab.pinned, active: !!tab.active, assigned: previous?.assigned || false,
    index: tab.index, lastAccessed: tab.lastAccessed || previous?.lastAccessed || 0,
  }
}

export function signature(tabs) { return JSON.stringify(tabs.map(tab => tab.url || tab.pendingUrl || '')) }

export function urlOverlap(first, second) {
  const counts = new Map()
  for (const tab of first) counts.set(tab.url, (counts.get(tab.url) || 0) + 1)
  let shared = 0
  for (const tab of second) {
    if (counts.get(tab.url) > 0) { shared += 1; counts.set(tab.url, counts.get(tab.url) - 1) }
  }
  return { shared, score: shared / Math.max(first.length, second.length, 1) }
}