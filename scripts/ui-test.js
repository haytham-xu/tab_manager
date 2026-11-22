import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const address = process.argv[2]
if (!address) throw new Error('Pass the running preview URL as the first argument.')
const root = fileURLToPath(new URL('../', import.meta.url))
const reports = path.join(root, '.test-runtime')
await mkdir(reports, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 2056, height: 1290 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(address)
  await page.locator('.topic.archived .tab-favicon').first().waitFor()
  await page.waitForFunction(() => document.querySelector('.brand-mark')?.naturalWidth > 0)
  const desktop = await page.evaluate(() => {
    const header = document.querySelector('.app-header')
    const archive = document.querySelector('.topic.archived')
    const live = document.querySelector('.topic:not(.archived)')
    return {
      headerControls: ['.view-switch', '.search-field', '[aria-label="Refresh tabs"]', '[aria-label="Window actions"]'].every(selector => !!header.querySelector(selector)),
      brandIconLoaded: header.querySelector('.brand-mark').naturalWidth === 32,
      separateToolbar: !!document.querySelector('.workspace-toolbar'),
      firstTopicLive: !document.querySelector('.topics > .topic').classList.contains('archived'),
      archivedFilter: getComputedStyle(archive.querySelector('.tab-favicon')).filter,
      archivedHeader: getComputedStyle(archive.querySelector('.topic-header')).backgroundColor,
      liveHeader: getComputedStyle(live.querySelector('.topic-header')).backgroundColor,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
  assert.equal(desktop.headerControls, true)
  assert.equal(desktop.brandIconLoaded, true)
  assert.equal(desktop.separateToolbar, false)
  assert.equal(desktop.firstTopicLive, true)
  assert.equal(desktop.archivedFilter, 'grayscale(1)')
  assert.notEqual(desktop.archivedHeader, desktop.liveHeader)
  assert.equal(desktop.overflow, false)
  await page.screenshot({ path: path.join(reports, 'preview-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: /^Hibernate/ }).click()
  await page.locator('.topic').first().waitFor()
  await page.getByRole('button', { name: /^Regular/ }).click()
  await page.getByRole('searchbox', { name: 'Search tabs or topics' }).fill('Design systems')
  assert.equal(await page.locator('.topic').count(), 1)
  await page.getByRole('searchbox', { name: 'Search tabs or topics' }).fill('')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(reports, 'preview-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, desktop, mobileOverflow: false }, null, 2))
} finally { await browser.close() }