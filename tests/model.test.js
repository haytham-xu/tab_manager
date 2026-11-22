import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/core/database'
import { chromeBrowser } from '../src/core/chrome-browser'
import { duplicateColors, exactMatches, initialState, makeBackup, normalizeGroup, validateBackup } from '../src/core/model'

describe('local tab state', () => {
  it('uses complete URL equality for duplicates and archived lookup', () => {
    const url = 'https://test.invalid/Path?a=1&b=2#A'
    const groups = [{ id: 'topic', name: 'Topic', tabs: [{ id: 'tab', url }, { id: 'same', url }] }]
    expect(exactMatches(groups, url)).toHaveLength(1)
    expect(duplicateColors(groups).has(url)).toBe(true)
    for (const changed of [url.toLowerCase(), url.replace('a=1', 'a=2'), url.replace('a=1&b=2', 'b=2&a=1'), url.replace('#A', '')]) {
      expect(exactMatches(groups, changed)).toEqual([])
    }
  })

  it('imports into new archived identities without carrying Chrome IDs', () => {
    const state = initialState()
    state.groups = [{ name: 'Topic', hibernate: true, tabs: [{ url: 'about:blank', name: 'Named', title: 'Native', chromeId: 99 }] }]
    const imported = validateBackup(makeBackup(state))
    expect(imported[0].status).toBe('archived')
    expect(imported[0].tabs[0].chromeId).toBeNull()
    expect(imported[0].tabs[0].name).toBe('Named')
    expect(imported[0].hibernate).toBe(true)
  })

  it('rejects malformed or executable backup URLs before writing', () => {
    expect(() => validateBackup({})).toThrow()
    expect(() => validateBackup({ format: 'tab-manager-backup', version: 1, groups: [{ name: 'Bad', tabs: [{ url: 'javascript:alert(1)' }] }] })).toThrow()
  })

  it('includes retained tabs in backups without opening them', () => {
    const state = initialState()
    state.groups = [{ name: 'Topic', tabs: [], retainedTabs: [{ url: 'about:blank', title: 'Closed tab', name: '' }] }]
    expect(makeBackup(state).groups[0].tabs[0].title).toBe('Closed tab')
  })

  it('retains cached tab records from older local snapshots without changing live tabs', () => {
    const stored = { name: 'Topic', tabs: [{ id: 'live', url: 'about:blank' }], cachedTabs: [{ id: 'saved', url: 'about:blank#saved' }] }
    const group = normalizeGroup(stored)
    expect(group.tabs).toEqual(stored.tabs)
    expect(group.retainedTabs).toEqual(stored.cachedTabs)
    expect(group.cachedTabs).toBeUndefined()
    expect(stored.cachedTabs).toHaveLength(1)
    expect(normalizeGroup(group).retainedTabs).toHaveLength(1)
  })

  it('persists independent state in IndexedDB', async () => {
    const database = createDatabase(`test-${crypto.randomUUID()}`)
    const state = initialState()
    state.settings.reuseEnabled = true
    await database.save(state)
    expect((await database.load()).settings.reuseEnabled).toBe(true)
    await database.close()
  })

  it('excludes management and chooser pages and incognito tabs', async () => {
    const browser = chromeBrowser({
      runtime: { getURL: () => 'chrome-extension://test/' },
      tabs: { query: async () => [
        { id: 1, windowId: 7, url: 'about:blank' },
        { id: 2, windowId: 7, url: 'chrome-extension://test/index.html' },
        { id: 3, windowId: 7, url: 'chrome-extension://test/chooser.html' },
        { id: 4, windowId: 8, url: 'about:blank', incognito: true },
      ] },
    })
    expect((await browser.listTabs()).map(tab => tab.id)).toEqual([1])
  })

  it('restores a topic in the background and focuses only the selected tab once', async () => {
    const calls = []
    const browser = chromeBrowser({
      windows: {
        create: async options => { calls.push(['create', options]); return { id: 7, tabs: [{ id: 11, windowId: 7 }] } },
        get: async () => ({ state: 'normal' }),
        update: async (id, options) => { calls.push(['focus', id, options]) },
      },
      tabs: {
        create: async () => ({ id: 12, windowId: 7 }),
        get: async id => ({ id, windowId: 7 }),
        update: async (id, options) => { calls.push(['activate', id, options]) },
      },
    })
    await browser.restore([{ id: 'first', url: 'about:blank' }, { id: 'target', url: 'about:blank#target' }], 'target')
    expect(calls.filter(call => call[0] === 'create')[0][1].focused).toBe(false)
    expect(calls.filter(call => call[0] === 'focus')).toHaveLength(1)
    expect(calls.filter(call => call[0] === 'activate')).toEqual([['activate', 12, { active: true }]])
  })
})