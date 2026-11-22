import { createDatabase } from './core/database'
import { TabEngine } from './core/engine'
import { initialState } from './core/model'

export const isExtension = location.protocol === 'chrome-extension:' && !!globalThis.chrome?.runtime?.id
let preview

async function previewEngine() {
  if (preview) return preview
  preview = (async () => {
    const database = createDatabase('tab-manager-preview')
    let saved = await database.load()
    if (!saved.groups.length) {
      saved = initialState()
      saved.session = 'preview'
      const topics = ['Product launch', 'Reading room', 'Design systems', 'Weekend plans', 'Research archive', 'Quiet projects']
      const titles = ['Launch checklist and decisions', 'Notes from the last review', 'A reference worth keeping', 'Release timeline', 'Working document', 'Open questions']
      saved.groups = topics.map((name, index) => ({
        id: `preview-${index}`, name, status: index >= 4 ? 'archived' : 'live', windowId: index >= 4 ? null : index + 1,
        hibernate: index === 5, main: index === 0, order: index, archivedAt: Date.now(),
        tabs: titles.slice(0, index === 0 ? 6 : 4).map((title, tabIndex) => ({
          id: `preview-tab-${index}-${tabIndex}`, chromeId: index >= 4 ? null : index * 10 + tabIndex + 10,
          title, name: '', url: `${location.origin}/reading/${tabIndex}${index === 1 ? '' : `?topic=${index}`}`,
          favicon: '', pinned: tabIndex === 0, active: tabIndex === 2, assigned: index !== 0 || tabIndex < 3,
          index: tabIndex, lastAccessed: Date.now(),
        })),
      }))
      await database.save(saved)
    }
    let raw = saved.groups.filter(group => group.status === 'live').flatMap(group => group.tabs.map(tab => ({
      ...tab, id: tab.chromeId, windowId: group.windowId, status: 'complete', favIconUrl: tab.favicon,
    })))
    let nextId = Math.max(1000, ...raw.map(tab => tab.id))
    let nextWindow = Math.max(100, ...raw.map(tab => tab.windowId))
    const browser = {
      session: async () => 'preview', listTabs: async () => structuredClone(raw),
      getTab: async id => { const tab = raw.find(item => item.id === id); if (!tab) throw new Error('Tab is closed.'); return { ...tab } },
      activate: async id => {
        const tab = raw.find(item => item.id === id)
        for (const item of raw) if (item.windowId === tab.windowId) item.active = item.id === id
      },
      closeTab: async id => { raw = raw.filter(tab => tab.id !== id) },
      closeWindow: async id => { raw = raw.filter(tab => tab.windowId !== id) },
      moveTab: async (id, windowId) => { raw.find(tab => tab.id === id).windowId = windowId },
      reorderTabs: async ids => { ids.forEach((id, index) => { raw.find(tab => tab.id === id).index = index }) },
      createTab: async (windowId, savedTab) => {
        const tab = { id: ++nextId, windowId, index: raw.filter(item => item.windowId === windowId).length, url: savedTab.url, title: savedTab.title, pinned: savedTab.pinned, status: 'complete' }
        raw.push(tab)
        return tab
      },
      restore: async (tabs, targetId) => {
        const windowId = ++nextWindow
        const rows = []
        for (const tab of tabs) rows.push({ savedId: tab.id, tab: await browser.createTab(windowId, tab) })
        await browser.activate((rows.find(row => row.savedId === targetId) || rows[0]).tab.id)
        return { windowId, rows }
      },
      showChooser: async () => {},
    }
    const engine = new TabEngine({ browser, database })
    await engine.ready
    return engine
  })()
  return preview
}

export async function request(action, payload = {}) {
  if (!isExtension) return (await previewEngine()).request(action, payload)
  const response = await chrome.runtime.sendMessage({ channel: 'tab-manager', action, payload })
  if (!response?.ok) throw new Error(response?.error || 'The extension worker is unavailable. Reload the extension and try again.')
  return response.result
}

export function subscribe(callback) {
  if (!isExtension) return () => {}
  const listener = message => { if (message.channel === 'tab-manager' && message.event === 'changed') callback() }
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}