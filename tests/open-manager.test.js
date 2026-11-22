import { describe, expect, it } from 'vitest'
import { createManagerOpener } from '../src/background/open-manager'

function fixture(tabs = []) {
  const calls = []
  const api = {
    runtime: { getURL: name => `chrome-extension://test/${name}` },
    tabs: {
      query: async () => tabs,
      create: async values => { calls.push(['create', values]) },
      get: async id => tabs.find(tab => tab.id === id),
      update: async (id, values) => { calls.push(['activate', id, values]) },
    },
    windows: {
      get: async () => ({ state: 'minimized' }),
      update: async (id, values) => { calls.push(['focus', id, values]) },
    },
  }
  return { calls, open: createManagerOpener(api) }
}

describe('extension icon opens manager directly', () => {
  it('creates exactly one manager for concurrent icon clicks', async () => {
    const app = fixture()
    await Promise.all([app.open(), app.open(), app.open()])
    expect(app.calls).toEqual([['create', { url: 'chrome-extension://test/index.html', active: true }]])
  })

  it('reuses an existing manager and brings its minimized window forward', async () => {
    const app = fixture([{ id: 11, windowId: 7, url: 'chrome-extension://test/index.html#regular' }])
    await app.open()
    expect(app.calls).toEqual([
      ['activate', 11, { active: true }], ['focus', 7, { state: 'normal', focused: true }],
    ])
  })

  it('prefers a manager in the clicked window', async () => {
    const app = fixture([
      { id: 11, windowId: 7, url: 'chrome-extension://test/index.html' },
      { id: 21, windowId: 8, url: 'chrome-extension://test/index.html?view=regular' },
    ])
    await app.open({ windowId: 8 })
    expect(app.calls[0]).toEqual(['activate', 21, { active: true }])
  })
})