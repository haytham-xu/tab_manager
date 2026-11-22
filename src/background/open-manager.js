import { chromeBrowser } from '../core/chrome-browser'

export function createManagerOpener(api) {
  const browser = chromeBrowser(api)
  let opening = null
  return function openManager(clickedTab) {
    if (opening) return opening
    opening = (async () => {
      const url = api.runtime.getURL('index.html')
      const tabs = (await api.tabs.query({})).filter(tab => !tab.incognito && tab.url?.split(/[?#]/)[0] === url)
      const target = tabs.find(tab => tab.windowId === clickedTab?.windowId) || tabs[0]
      if (target) await browser.activate(target.id)
      else await api.tabs.create({ url, active: true })
    })().finally(() => { opening = null })
    return opening
  }
}