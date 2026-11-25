import { LAYOUT_OPTIONS, normalizeSettings } from './model'

export const LAYOUT_PRESETS = [
  { id: 'compact', label: 'Compact', viewportWidth: 1280, sandboxWidth: 480, topicWidth: 320, topicVisibleTabs: 5 },
  { id: 'laptop', label: 'Laptop', viewportWidth: 1440, sandboxWidth: 500, topicWidth: 330, topicVisibleTabs: 6 },
  { id: 'desktop', label: 'Desktop', viewportWidth: 1920, sandboxWidth: 560, topicWidth: 360, topicVisibleTabs: 7 },
  { id: 'qhd', label: 'QHD', viewportWidth: 2560, sandboxWidth: 640, topicWidth: 380, topicVisibleTabs: 9 },
  { id: 'ultrawide', label: 'Ultrawide', viewportWidth: 3440, sandboxWidth: 760, topicWidth: 400, topicVisibleTabs: 10 },
]

export const LAYOUT_METRICS = { workspaceGap: 14, topicGap: 12, tabRowHeight: 41, topicChromeHeight: 75, maxGridRows: 3 }

export function closestLayoutPreset(width) {
  return LAYOUT_PRESETS.reduce((closest, preset) => Math.abs(width - preset.viewportWidth) < Math.abs(width - closest.viewportWidth) ? preset : closest)
}

export function resolveLayout(saved, area = {}) {
  const settings = normalizeSettings(saved)
  const preset = settings.layoutMode === 'auto' ? closestLayoutPreset(area.viewportWidth ?? area.width) : null
  const sizes = preset || settings
  const workspaceGap = area.workspaceGap ?? LAYOUT_METRICS.workspaceGap
  const topicGap = area.topicGap ?? LAYOUT_METRICS.topicGap
  const rowHeight = area.tabRowHeight || LAYOUT_METRICS.tabRowHeight
  const chromeHeight = area.topicChromeHeight ?? LAYOUT_METRICS.topicChromeHeight
  const width = Math.max(0, area.width || 0)
  const stacked = settings.sandboxVisible && width > 0 && width < sizes.sandboxWidth + sizes.topicWidth + workspaceGap
  const topicArea = Math.max(0, width - (settings.sandboxVisible && !stacked ? sizes.sandboxWidth + workspaceGap : 0))
  const capacity = Math.max(1, Math.floor((topicArea + topicGap) / (sizes.topicWidth + topicGap)))
  const groupCount = Math.max(0, area.groupCount || 0)
  const columns = Math.min(capacity, Math.max(1, groupCount))
  let visibleTabs = sizes.topicVisibleTabs
  if (preset && Number.isFinite(area.height)) {
    const height = Math.max(0, area.height - (stacked ? (area.sandboxHeight || 0) + workspaceGap : 0))
    const gridRows = Math.min(LAYOUT_METRICS.maxGridRows, Math.max(1, Math.ceil(groupCount / columns)))
    const cardHeight = (height - topicGap * (gridRows - 1)) / gridRows
    visibleTabs = Math.max(LAYOUT_OPTIONS.topicVisibleTabs.min, Math.min(visibleTabs, Math.floor((cardHeight - chromeHeight) / rowHeight)))
  }
  return { mode: settings.layoutMode, preset, sandboxWidth: sizes.sandboxWidth, topicWidth: sizes.topicWidth, topicVisibleTabs: visibleTabs, columns, stacked }
}
