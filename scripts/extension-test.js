import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const reports = path.join(root, '.test-runtime')
await mkdir(reports, { recursive: true })
const profile = await mkdtemp(path.join(tmpdir(), 'tab-manager-test-'))
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><title>${request.url}</title><h1>Local test page</h1>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const extension = path.join(root, 'dist')
let context

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium', viewport: { width: 2056, height: 1290 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  })
  let worker = context.serviceWorkers()[0]
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`chrome-extension://${extensionId}/index.html`)
  await page.getByRole('heading', { name: 'Tab Manager', exact: true }).waitFor()
  const rpc = (action, payload = {}) => page.evaluate(async ({ action, payload }) => {
    const response = await chrome.runtime.sendMessage({ channel: 'tab-manager', action, payload })
    if (!response.ok) throw new Error(response.error)
    return response.result
  }, { action, payload })
  assert.equal(await worker.evaluate(() => chrome.action.onClicked.hasListeners()), true)
  assert.equal(await worker.evaluate(() => chrome.action.getPopup({})), '')
  assert.equal((await rpc('snapshot')).settings.reuseEnabled, true)
  await rpc('settings', { reuseEnabled: false })
  const poll = async (check, description) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (await check()) return
      await page.waitForTimeout(100)
    }
    throw new Error(`Timed out: ${description}`)
  }

  const created = await worker.evaluate(async ({ base }) => {
    const window = await chrome.windows.create({ url: [`${base}/guide?a=1#A`, `${base}/notes`, `${base}/review`], focused: false })
    return { windowId: window.id, ids: window.tabs.map(tab => tab.id) }
  }, { base })
  let snapshot = await rpc('snapshot')
  assert.equal(snapshot.groups.some(item => item.tabs.some(tab => tab.url.startsWith(`chrome-extension://${extensionId}/`))), false)
  const group = snapshot.groups.find(item => item.windowId === created.windowId)
  assert.equal(group.tabs.length, 3)
  await rpc('renameGroup', { groupId: group.id, name: 'Research topic' })
  const topic = page.locator(`.topic[data-group-id="${group.id}"]`)
  await poll(async () => await topic.locator('.sandbox-indicator').count() === 3, 'unassigned live tabs show Sandbox labels')
  assert.equal(await topic.locator('.sandbox-indicator').first().isVisible(), true)
  assert.equal(await page.locator('.sandbox-panel .sandbox-indicator').count(), 0)
  const topicMenu = topic.locator('details.action-menu')
  const globalMenu = page.locator('.app-header details.action-menu')
  await topicMenu.locator('summary').click()
  assert.equal(await topicMenu.evaluate(menu => menu.open), true)
  await page.getByRole('searchbox', { name: 'Search tabs or topics' }).click()
  assert.equal(await topicMenu.evaluate(menu => menu.open), false)
  await topicMenu.locator('summary').click()
  await globalMenu.locator('summary').click()
  assert.equal(await topicMenu.evaluate(menu => menu.open), false)
  assert.equal(await globalMenu.evaluate(menu => menu.open), true)
  await page.locator('.sandbox-panel .row-actions').first().getByRole('button', { name: 'Tab details', exact: true }).click()
  assert.equal(await globalMenu.evaluate(menu => menu.open), false)
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await rpc('settings', { sandboxVisible: false })
  await page.locator('.sandbox-panel').waitFor({ state: 'detached' })
  assert.equal(await topic.locator('.sandbox-indicator').first().isVisible(), true)
  await rpc('settings', { sandboxVisible: true })
  const firstTarget = page.locator(`.sandbox-panel .tab-row[data-tab-id="${group.tabs[0].id}"] select`)
  const manualTarget = page.locator(`.sandbox-panel .tab-row[data-tab-id="${group.tabs[1].id}"] select`)
  await rpc('import', { backup: { format: 'tab-manager-backup', version: 1, groups: [
    { name: 'Manual target fixture', tabs: [{ url: 'about:blank#manual-target' }] },
  ] } })
  const manualArchive = (await rpc('snapshot')).groups.find(item => item.name === 'Manual target fixture')
  await manualTarget.selectOption(manualArchive.id)
  const detached = await worker.evaluate(async tabId => chrome.windows.create({ tabId, focused: false }), created.ids[0])
  const detachedGroup = (await rpc('snapshot')).groups.find(item => item.windowId === detached.id)
  await poll(async () => await firstTarget.inputValue() === detachedGroup.id, 'Sandbox default follows tab detached into a new window')
  await page.locator(`.topic[data-group-id="${detachedGroup.id}"] .topic-name`).click()
  await page.getByLabel('Name', { exact: true }).fill('Agile')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await poll(async () => await firstTarget.locator('option:checked').textContent() === 'Agile', 'Sandbox target shows renamed group')
  await worker.evaluate(async ({ id, windowId }) => chrome.tabs.move(id, { windowId, index: -1 }), { id: created.ids[1], windowId: detached.id })
  await poll(async () => {
    const current = await rpc('snapshot')
    return current.groups.find(item => item.windowId === detached.id)?.tabs.some(tab => tab.id === group.tabs[1].id)
  }, 'second unassigned tab moves to the new group')
  assert.equal(await manualTarget.inputValue(), manualArchive.id)
  await worker.evaluate(async ({ ids, windowId }) => chrome.tabs.move(ids, { windowId, index: 0 }), { ids: created.ids.slice(0, 2), windowId: created.windowId })
  await poll(async () => await firstTarget.inputValue() === group.id, 'Sandbox default follows tab moved back to original window')
  await rpc('delete', { groupId: manualArchive.id })
  await poll(async () => await manualTarget.inputValue() === group.id, 'deleted manual target falls back to current group')
  await rpc('assign', { tabIds: [group.tabs[0].id] })
  await poll(async () => await topic.locator('.sandbox-indicator').count() === 2, 'assigning a tab removes only its Sandbox label')
  await rpc('assign', { tabIds: group.tabs.slice(1).map(tab => tab.id) })
  await poll(async () => await topic.locator('.sandbox-indicator').count() === 0, 'assigned topic has no Sandbox labels')
  await topic.locator('.action-menu summary').click()
  await topic.getByRole('button', { name: 'Archive window', exact: true }).click()
  await poll(async () => (await topic.getAttribute('class')).includes('archived'), 'menu command archives topic')
  assert.equal(await topic.locator('details.action-menu').evaluate(menu => menu.open), false)
  snapshot = await rpc('snapshot')
  assert.equal(snapshot.groups.find(item => item.id === group.id).status, 'archived')
  await rpc('restore', { groupId: group.id, tabId: group.tabs[1].id })
  snapshot = await rpc('snapshot')
  const restored = snapshot.groups.find(item => item.id === group.id)
  assert.equal(restored.tabs.length, 3)
  assert.equal(restored.name, 'Research topic')
  const activated = await worker.evaluate(async id => chrome.tabs.get(id), restored.tabs.find(tab => tab.id === group.tabs[1].id).chromeId)
  assert.equal(activated.active, true)

  await rpc('settings', { reuseEnabled: true })
  const exact = `${base}/guide?a=1#A`
  const duplicate = await worker.evaluate(async ({ windowId, url }) => chrome.tabs.create({ windowId, url }), { windowId: restored.windowId, url: exact })
  await poll(async () => !(await worker.evaluate(async () => chrome.tabs.query({}))).some(tab => tab.id === duplicate.id), 'exact duplicate closes')
  const blank = await worker.evaluate(async windowId => chrome.tabs.create({ windowId, url: 'about:blank' }), restored.windowId)
  await page.waitForTimeout(1000)
  await worker.evaluate(async ({ id, url }) => chrome.tabs.update(id, { url }), { id: blank.id, url: exact })
  await poll(async () => !(await worker.evaluate(async () => chrome.tabs.query({}))).some(tab => tab.id === blank.id), 'blank tab later navigates to exact duplicate and closes')
  const different = await worker.evaluate(async ({ windowId, url }) => chrome.tabs.create({ windowId, url }), { windowId: restored.windowId, url: `${base}/guide?a=2#A` })
  await page.waitForTimeout(1200)
  assert.equal((await worker.evaluate(async id => chrome.tabs.get(id), different.id)).url, `${base}/guide?a=2#A`)
  await rpc('settings', { reuseEnabled: false })
  await rpc('archive', { groupId: group.id })
  await rpc('settings', { reuseEnabled: true })
  const opener = await worker.evaluate(async url => chrome.windows.create({ url }), exact)
  await poll(async () => {
    const state = await rpc('snapshot')
    return state.groups.find(item => item.id === group.id)?.status === 'live'
  }, 'archived topic restores automatically')
  await poll(async () => !(await worker.evaluate(async () => chrome.tabs.query({}))).some(tab => tab.id === opener.tabs[0].id), 'new archive opener closes')
  snapshot = await rpc('snapshot')
  assert.equal(snapshot.groups.find(item => item.id === group.id).tabs.length, 4)

  await rpc('settings', { reuseEnabled: false })
  const backup = await rpc('backup')
  assert.equal(backup.format, 'tab-manager-backup')
  const imported = await rpc('import', { backup: { ...backup, groups: [backup.groups.find(item => item.name === 'Research topic')] } })
  assert.equal(imported.imported, 1)
  await rpc('archive', { groupId: group.id })
  await rpc('settings', { reuseEnabled: true })
  const choiceTab = await worker.evaluate(async url => chrome.tabs.create({ url }), exact)
  await poll(async () => context.pages().some(item => item.url().includes('chooser.html')), 'archive chooser opens')
  const chooser = context.pages().find(item => item.url().includes('chooser.html'))
  await chooser.getByRole('heading', { name: 'Restore a topic' }).waitFor()
  assert.equal(await chooser.locator('.choice-list button').count(), 2)
  await chooser.getByRole('button', { name: 'Keep new tab' }).click()
  await poll(async () => chooser.isClosed(), 'chooser closes after cancellation')
  assert.equal((await worker.evaluate(async id => chrome.tabs.get(id), choiceTab.id)).url, exact)
  await rpc('settings', { reuseEnabled: false })

  snapshot = await rpc('snapshot')
  const liveTarget = snapshot.groups.find(item => item.status === 'live')
  await rpc('main', { groupId: group.id, value: true })
  const batchTopic = page.locator(`.topic[data-group-id="${group.id}"]`)
  await batchTopic.locator('.action-menu summary').click()
  await batchTopic.getByRole('button', { name: 'Batch manage', exact: true }).click()
  await page.locator('.batch-list .batch-row input[type="checkbox"]').first().check()
  assert.equal(await page.locator('.batch-actions > span').textContent(), '1 selected')
  await page.getByLabel('Batch target topic').selectOption(liveTarget.id)
  await page.locator('dialog').getByRole('button', { name: 'Move', exact: true }).click()
  await poll(async () => (await page.locator('.batch-actions > span').textContent()) === '0 selected', 'batch move clears selection')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  const manual = await worker.evaluate(async base => chrome.windows.create({ url: [`${base}/manual-one`, `${base}/manual-two`], focused: false }), base)
  snapshot = await rpc('snapshot')
  const manualGroup = snapshot.groups.find(item => item.windowId === manual.id)
  await rpc('renameGroup', { groupId: manualGroup.id, name: 'Manual closure topic' })
  await worker.evaluate(async id => chrome.windows.remove(id), manual.id)
  await poll(async () => (await rpc('snapshot')).groups.find(item => item.id === manualGroup.id)?.status === 'archived', 'manual close archives topic')
  assert.equal((await rpc('snapshot')).groups.find(item => item.id === manualGroup.id).tabs.length, 2)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('heading', { name: 'Settings & backup' }).waitFor()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.locator('.sandbox-switch button').click()
  assert.equal(await page.locator('.sandbox-panel').count(), 0)
  await page.locator('.sandbox-switch button').click()
  await page.locator('.sandbox-panel').waitFor()

  await page.screenshot({ path: path.join(reports, 'desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(reports, 'mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('PASS: actual MV3 extension loaded, native archive/restore, exact reuse, automatic topic restore, chooser cancellation, backup import, batch move, manual window closure, desktop/mobile UI, and CSP')
} finally {
  if (context) await context.close()
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}