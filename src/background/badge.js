export function createBadgeUpdater({ api, getGroups }) {
  const cache = new Map()
  let initialized = false
  let requested = false
  let running = null

  async function update() {
    if (!initialized) {
      await api.action.setBadgeText({ text: '' })
      await api.action.setTitle({ title: 'Tab Manager' })
      await api.action.setBadgeBackgroundColor({ color: '#176b50' })
      initialized = true
    }
    const names = new Map(getGroups().filter(group => group.status === 'live')
      .map(group => [group.windowId, (group.name || '').trim()]))
    const tabs = await api.tabs.query({})
    const current = new Set(tabs.map(tab => tab.id))
    for (const id of cache.keys()) if (!current.has(id)) cache.delete(id)
    for (const tab of tabs) {
      const name = tab.incognito ? '' : names.get(tab.windowId) || ''
      if (cache.get(tab.id) === name) continue
      try {
        await api.action.setBadgeText({ tabId: tab.id, text: Array.from(name).slice(0, 4).join('') })
        await api.action.setTitle({ tabId: tab.id, title: name ? `Tab Manager - ${name}` : 'Tab Manager' })
        cache.set(tab.id, name)
      } catch {
        cache.delete(tab.id)
      }
    }
  }

  function schedule() {
    requested = true
    if (!running) {
      running = (async () => {
        while (requested) { requested = false; await update() }
      })().catch(() => {}).finally(() => { running = null; if (requested) schedule() })
    }
    return running
  }

  return { update, schedule }
}