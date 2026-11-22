import { createDatabase } from '../core/database'
import { chromeBrowser } from '../core/chrome-browser'
import { TabEngine } from '../core/engine'
import { createBadgeUpdater } from './badge'
import { createManagerOpener } from './open-manager'

const openManager = createManagerOpener(chrome)
chrome.action.onClicked.addListener(tab => {
  openManager(tab).catch(error => console.warn('Unable to open Tab Manager:', error))
})

let badge = null
const engine = new TabEngine({
  browser: chromeBrowser(), database: createDatabase(),
  onChange: () => {
    chrome.runtime.sendMessage({ channel: 'tab-manager', event: 'changed' }).catch(() => {})
    badge?.schedule()
  },
})
badge = createBadgeUpdater({ api: chrome, getGroups: () => engine.state?.groups || [] })
const timers = new Map()

function schedule(id) {
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => {
    timers.delete(id)
    engine.request('reuse', { chromeId: id }).catch(async () => {
      await engine.enqueue(async () => { delete engine.state.candidates[id]; await engine.save() })
    })
  }, 700))
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.channel !== 'tab-manager' || !message.action || sender.id !== chrome.runtime.id) return
  engine.request(message.action, message.payload).then(
    result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message }),
  )
  return true
})

chrome.tabs.onCreated.addListener(tab => {
  const managed = engine.creating > 0
  engine.event('created', { tab, managed, createdAt: Date.now() }).then(() => {
    if (!managed) schedule(tab.id)
  }).catch(() => {})
})
chrome.tabs.onUpdated.addListener((id, changes) => {
  if (changes.url || changes.title || changes.status === 'complete' || changes.favIconUrl || changes.pinned !== undefined) {
    engine.event('sync', {}).then(() => schedule(id)).catch(() => {})
  }
})
chrome.tabs.onRemoved.addListener((id, info) => {
  clearTimeout(timers.get(id))
  timers.delete(id)
  engine.event('removed', { id, windowClosing: info.isWindowClosing }).catch(() => {})
})
chrome.tabs.onActivated.addListener(() => { engine.event('sync', {}).then(() => badge.schedule()).catch(() => {}) })
chrome.windows.onFocusChanged.addListener(id => { if (id !== chrome.windows.WINDOW_ID_NONE) badge.schedule() })
chrome.windows.onRemoved.addListener(() => { engine.event('sync', {}).catch(() => {}) })
chrome.tabs.onAttached.addListener(() => { engine.event('sync', {}).catch(() => {}) })
chrome.runtime.onStartup.addListener(() => {
  engine.startupUntil = Date.now() + 15000
  engine.enqueue(async () => { engine.state.candidates = {}; await engine.save() }).catch(() => {})
})
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'reconcile') engine.event('sync', {}).catch(() => {}) })
chrome.alarms.create('reconcile', { periodInMinutes: 0.5 })
engine.ready.then(() => {
  badge.schedule()
  for (const id of Object.keys(engine.state.candidates)) schedule(Number(id))
}).catch(() => {})