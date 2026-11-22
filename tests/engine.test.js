import { beforeEach, describe, expect, it } from 'vitest'
import { TabEngine } from '../src/core/engine'
import { initialState } from '../src/core/model'

const url = 'https://test.invalid/Path?a=1#A'
function fixture() {
  let stored = initialState()
  let tabs = [{ id: 1, windowId: 7, index: 0, url, title: 'First', status: 'complete' }]
  const calls = []
  let restoreFails = false
  let closeFails = false
  const browser = {
    session: async () => 'session', listTabs: async () => structuredClone(tabs),
    getTab: async id => { const tab = tabs.find(item => item.id === id); if (!tab) throw new Error('Gone'); return { ...tab } },
    activate: async id => calls.push(['activate', id]),
    closeTab: async id => { calls.push(['close', id, structuredClone(stored.groups)]); if (closeFails) throw new Error('Close failed'); tabs = tabs.filter(tab => tab.id !== id) },
    closeWindow: async windowId => { tabs = tabs.filter(tab => tab.windowId !== windowId) },
    moveTab: async (id, windowId) => { tabs.find(tab => tab.id === id).windowId = windowId },
    reorderTabs: async () => {}, showChooser: async token => calls.push(['chooser', token]),
    restore: async (saved, targetId) => {
      calls.push(['restore', saved.length, targetId])
      if (restoreFails) throw new Error('Restore failed')
      const rows = saved.map((tab, index) => ({ savedId: tab.id, tab: { id: 50 + index, windowId: 8, index, url: tab.url, title: tab.title, status: 'complete' } }))
      tabs.push(...rows.map(row => row.tab))
      return { windowId: 8, rows }
    },
  }
  const database = { load: async () => structuredClone(stored), save: async state => { stored = structuredClone(state) } }
  return { browser, database, calls, get stored() { return stored }, set tabs(value) { tabs = value }, get tabs() { return tabs }, failRestore() { restoreFails = true }, failClose() { closeFails = true } }
}

describe('browser-independent engine', () => {
  let app
  let engine
  beforeEach(async () => { app = fixture(); engine = new TabEngine(app); await engine.ready })

  it('enables exact reuse by default without overwriting an explicitly saved off setting', async () => {
    expect(engine.state.settings.reuseEnabled).toBe(true)
    await engine.request('settings', { reuseEnabled: false })
    const restarted = new TabEngine(app)
    await restarted.ready
    expect(restarted.state.settings.reuseEnabled).toBe(false)
  })

  it('tracks new tabs as Sandbox entries and assigns them locally', async () => {
    const tab = engine.state.groups[0].tabs[0]
    expect(tab.assigned).toBe(false)
    await engine.request('assign', { tabIds: [tab.id] })
    expect(engine.locate(tab.id).tab.assigned).toBe(true)
  })

  it('archives manually closed windows from cached tabs exactly once', async () => {
    const group = engine.state.groups[0]
    app.tabs = []
    await engine.event('removed', { id: 1, windowClosing: true })
    await engine.request('snapshot')
    await engine.request('snapshot')
    expect(engine.state.groups).toHaveLength(1)
    expect(engine.group(group.id).status).toBe('archived')
    expect(engine.group(group.id).tabs[0].url).toBe(url)
  })

  it('restores a complete topic but preserves it when creation fails', async () => {
    const id = engine.state.groups[0].id
    await engine.request('archive', { groupId: id })
    app.failRestore()
    await expect(engine.request('restore', { groupId: id })).rejects.toThrow('Restore failed')
    expect(engine.group(id).status).toBe('archived')
  })

  it('freezes all cached tabs when a closing window temporarily reports only some tabs', async () => {
    app.tabs.push({ id: 2, windowId: 7, index: 1, url: url + 'second', status: 'complete' })
    await engine.request('snapshot')
    const id = engine.state.groups[0].id
    app.tabs = app.tabs.filter(tab => tab.id !== 1)
    await engine.event('removed', { id: 1, windowClosing: true })
    await engine.event('sync', {})
    expect(engine.group(id).status).toBe('archived')
    expect(engine.group(id).tabs).toHaveLength(2)
  })

  it('rejects duplicate restored mappings without replacing the archive', async () => {
    const id = engine.state.groups[0].id
    await engine.request('archive', { groupId: id })
    engine.group(id).tabs.push({ ...engine.group(id).tabs[0], id: 'second', url: url + 'second' })
    app.browser.restore = async () => ({ windowId: 8, rows: [
      { savedId: engine.group(id).tabs[0].id, tab: { id: 50 } },
      { savedId: engine.group(id).tabs[0].id, tab: { id: 51 } },
    ] })
    await expect(engine.request('restore', { groupId: id })).rejects.toThrow('every tab')
    expect(engine.group(id).status).toBe('archived')
  })

  it('saves a transfer into an archive before attempting to close its source', async () => {
    const group = engine.state.groups[0]
    const archive = { ...structuredClone(group), id: 'archive', status: 'archived', windowId: null, tabs: [] }
    engine.state.groups.push(archive)
    app.failClose()
    await expect(engine.request('transfer', { tabIds: [group.tabs[0].id], groupId: 'archive' })).rejects.toThrow('Close failed')
    expect(app.calls[0][2].find(item => item.id === 'archive').tabs[0].url).toBe(url)
    expect(engine.group(group.id).tabs).toHaveLength(1)
  })

  it('reuses an exact live match before closing the new tab', async () => {
    await engine.request('settings', { reuseEnabled: true })
    app.tabs.push({ id: 2, windowId: 7, index: 1, url, title: 'Duplicate', status: 'complete' })
    await engine.event('created', { tab: app.tabs[1], createdAt: Date.now(), managed: false })
    await engine.request('reuse', { chromeId: 2 })
    expect(app.calls.map(call => call.slice(0, 2))).toEqual([['activate', 1], ['close', 2]])
  })

  it('does not merge URLs with different parameters or fragments', async () => {
    await engine.request('settings', { reuseEnabled: true })
    app.tabs.push({ id: 2, windowId: 7, index: 1, url: url + 'different', status: 'complete' })
    await engine.event('created', { tab: app.tabs[1], createdAt: Date.now(), managed: false })
    await engine.request('reuse', { chromeId: 2 })
    expect(app.calls).toEqual([])
  })

  it('restores all archived tabs and targets the matching topic tab', async () => {
    const id = engine.state.groups[0].id
    const targetId = engine.state.groups[0].tabs[0].id
    await engine.request('archive', { groupId: id })
    await engine.request('settings', { reuseEnabled: true })
    app.tabs = [{ id: 2, windowId: 9, index: 0, url, status: 'complete' }]
    await engine.event('created', { tab: app.tabs[0], createdAt: Date.now(), managed: false })
    await engine.request('reuse', { chromeId: 2 })
    expect(app.calls[0]).toEqual(['restore', 1, targetId])
    expect(engine.group(id).status).toBe('live')
    expect(app.tabs.some(tab => tab.id === 2)).toBe(false)
  })

  it('provides a chooser for multiple matching topics and cancellation keeps the tab', async () => {
    const id = engine.state.groups[0].id
    await engine.request('archive', { groupId: id })
    engine.state.groups.push({ ...structuredClone(engine.group(id)), id: 'second' })
    await engine.request('settings', { reuseEnabled: true })
    app.tabs = [{ id: 2, windowId: 9, index: 0, url, status: 'complete' }]
    await engine.event('created', { tab: app.tabs[0], createdAt: Date.now(), managed: false })
    await engine.request('reuse', { chromeId: 2 })
    const token = Object.keys(engine.state.choices)[0]
    expect(engine.state.choices[token].matches).toHaveLength(2)
    await engine.request('choose', { token })
    expect(app.tabs).toHaveLength(1)
    expect(engine.state.groups.filter(group => group.status === 'archived')).toHaveLength(2)
  })

  it('recovers a named window after a restart with changed IDs and one missing tab without a duplicate group', async () => {
    app.tabs = Array.from({ length: 10 }, (_, index) => ({ id: index + 10, windowId: 7, index, url: `${url}-${index}`, status: 'complete' }))
    await engine.request('snapshot')
    const id = engine.state.groups[0].id
    await engine.request('renameGroup', { groupId: id, name: 'Main' })
    app.tabs = app.tabs.slice(0, 9).reverse().map((tab, index) => ({ ...tab, id: 100 + index, windowId: 99, index }))
    app.browser.session = async () => 'new-session'
    const recovered = new TabEngine(app)
    await recovered.ready
    expect(recovered.state.groups).toHaveLength(1)
    expect(recovered.group(id)).toMatchObject({ name: 'Main', status: 'live', windowId: 99 })
    expect(recovered.group(id).retainedTabs).toHaveLength(1)
  })

  it('does not reuse restored tabs when Chrome delivers their creation events after restore completes', async () => {
    const id = engine.state.groups[0].id
    await engine.request('archive', { groupId: id })
    engine.state.groups.push({ ...structuredClone(engine.group(id)), id: 'another-archive' })
    await engine.request('settings', { reuseEnabled: true })
    await engine.request('restore', { groupId: id })
    const tab = app.tabs[0]
    await engine.event('created', { tab, createdAt: Date.now(), managed: false })
    await engine.request('reuse', { chromeId: tab.id })
    await engine.event('sync', {})
    await engine.request('reuse', { chromeId: tab.id })
    expect(app.calls.filter(call => call[0] === 'restore')).toHaveLength(1)
    expect(engine.group('another-archive').status).toBe('archived')
  })

  it('never retries a consumed reuse decision and focus on later updates', async () => {
    await engine.request('settings', { reuseEnabled: true })
    app.tabs.push({ id: 2, windowId: 7, index: 1, url, status: 'complete' })
    await engine.event('created', { tab: app.tabs[1], createdAt: Date.now(), managed: false })
    app.browser.activate = async id => { app.calls.push(['activate', id]); throw new Error('Focus failed') }
    await expect(engine.request('reuse', { chromeId: 2 })).rejects.toThrow()
    await engine.request('reuse', { chromeId: 2 })
    expect(app.calls.filter(call => call[0] === 'activate')).toHaveLength(1)
    expect(app.tabs.some(tab => tab.id === 2)).toBe(true)
  })

  it('sorts live topics before even a main archived topic', () => {
    const live = engine.state.groups[0]
    engine.state.groups.push({ ...structuredClone(live), id: 'archive', status: 'archived', main: true, order: -1 })
    expect(engine.snapshot().groups[0].id).toBe(live.id)
  })

  it('keeps new-tab candidates on placeholder pages until an exact URL is entered', async () => {
    await engine.request('settings', { reuseEnabled: true })
    app.tabs.push({ id: 2, windowId: 7, index: 1, url: 'chrome://newtab/', status: 'complete' })
    await engine.event('created', { tab: app.tabs[1], createdAt: Date.now(), managed: false })
    await engine.request('reuse', { chromeId: 2 })
    expect(engine.state.candidates[2]).toBeDefined()
    expect(app.calls).toEqual([])
    Object.assign(app.tabs[1], { url, status: 'complete' })
    await engine.event('sync', {})
    await engine.request('reuse', { chromeId: 2 })
    expect(app.calls.map(call => call.slice(0, 2))).toEqual([['activate', 1], ['close', 2]])
  })

  it('waits for pending navigation before consuming a reuse decision', async () => {
    await engine.request('settings', { reuseEnabled: true })
    app.tabs.push({ id: 2, windowId: 7, index: 1, url: 'https://test.invalid/intermediate', pendingUrl: url, status: 'complete' })
    await engine.event('created', { tab: app.tabs[1], createdAt: Date.now(), managed: false })
    await engine.request('reuse', { chromeId: 2 })
    expect(engine.state.candidates[2]).toBeDefined()
    expect(app.calls).toEqual([])
    Object.assign(app.tabs[1], { url, pendingUrl: undefined })
    await engine.request('reuse', { chromeId: 2 })
    expect(app.calls.map(call => call.slice(0, 2))).toEqual([['activate', 1], ['close', 2]])
  })
})