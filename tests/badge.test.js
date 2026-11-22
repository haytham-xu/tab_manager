import { describe, expect, it } from 'vitest'
import { createBadgeUpdater } from '../src/background/badge'

function fixture() {
  const calls = []
  const groups = [{ status: 'live', windowId: 7, name: 'Research topic' }, { status: 'archived', windowId: null, name: 'Archive' }]
  const tabs = [{ id: 11, windowId: 7 }, { id: 12, windowId: 7 }, { id: 21, windowId: 8 }, { id: 31, windowId: 7, incognito: true }]
  const api = {
    tabs: { query: async () => tabs },
    action: {
      setBadgeText: async values => { calls.push(['badge', values]) },
      setTitle: async values => { calls.push(['title', values]) },
      setBadgeBackgroundColor: async values => { calls.push(['background', values]) },
    },
  }
  return { groups, tabs, calls, updater: createBadgeUpdater({ api, getGroups: () => groups }) }
}

describe('extension topic badges', () => {
  it('sets a short badge and full title for every tab in a named live window', async () => {
    const app = fixture()
    await app.updater.update()
    expect(app.calls).toContainEqual(['badge', { tabId: 11, text: 'Rese' }])
    expect(app.calls).toContainEqual(['title', { tabId: 12, title: 'Tab Manager - Research topic' }])
    expect(app.calls).toContainEqual(['badge', { tabId: 21, text: '' }])
    expect(app.calls).toContainEqual(['title', { tabId: 31, title: 'Tab Manager' }])
  })

  it('updates renamed groups and clears old names on unnamed windows', async () => {
    const app = fixture()
    await app.updater.update()
    app.calls.length = 0
    app.groups[0].name = 'Main'
    await app.updater.update()
    expect(app.calls).toContainEqual(['badge', { tabId: 11, text: 'Main' }])
    app.groups[0].name = ''
    await app.updater.update()
    expect(app.calls).toContainEqual(['badge', { tabId: 11, text: '' }])
    expect(app.calls).toContainEqual(['title', { tabId: 11, title: 'Tab Manager' }])
  })

  it('writes only changed per-tab names without touching browser focus APIs', async () => {
    const app = fixture()
    await app.updater.schedule()
    app.calls.length = 0
    await app.updater.schedule()
    expect(app.calls).toEqual([])
    app.tabs[0].windowId = 8
    await app.updater.schedule()
    expect(app.calls).toEqual([
      ['badge', { tabId: 11, text: '' }], ['title', { tabId: 11, title: 'Tab Manager' }],
    ])
  })

  it('truncates by Unicode code points rather than splitting characters', async () => {
    const app = fixture()
    app.groups[0].name = String.fromCodePoint(0x1f4da) + ' Reading'
    await app.updater.update()
    const badge = app.calls.find(call => call[0] === 'badge' && call[1].tabId === 11)[1].text
    expect(Array.from(badge)).toHaveLength(4)
    expect(badge.startsWith(String.fromCodePoint(0x1f4da))).toBe(true)
  })
})