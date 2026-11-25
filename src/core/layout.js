import { normalizeSettings } from './model'

export const LAYOUT_PRESETS = [
  { id: 'compact', label: 'Compact', viewportWidth: 1280, sandboxWidth: 480, topicWidth: 320 },
  { id: 'laptop', label: 'Laptop', viewportWidth: 1440, sandboxWidth: 500, topicWidth: 330 },
  { id: 'desktop', label: 'Desktop', viewportWidth: 1920, sandboxWidth: 560, topicWidth: 360 },
  { id: 'qhd', label: 'QHD', viewportWidth: 2560, sandboxWidth: 640, topicWidth: 380 },
  { id: 'ultrawide', label: 'Ultrawide', viewportWidth: 3440, sandboxWidth: 760, topicWidth: 400 },
]

export const LAYOUT_METRICS = { workspaceGap: 14, topicGap: 12 }

export function closestLayoutPreset(width) {
  return LAYOUT_PRESETS.reduce((closest, preset) => Math.abs(width - preset.viewportWidth) < Math.abs(width - closest.viewportWidth) ? preset : closest)
}

export function resolveLayout(saved, area = {}) {
  const settings = normalizeSettings(saved)
  const preset = settings.layoutMode === 'auto' ? closestLayoutPreset(area.viewportWidth ?? area.width) : null
  const sizes = preset || settings
  const workspaceGap = area.workspaceGap ?? LAYOUT_METRICS.workspaceGap
  const topicGap = area.topicGap ?? LAYOUT_METRICS.topicGap
  const width = Math.max(0, area.width || 0)
  const stacked = settings.sandboxVisible && width > 0 && width < sizes.sandboxWidth + sizes.topicWidth + workspaceGap
  const topicArea = Math.max(0, width - (settings.sandboxVisible && !stacked ? sizes.sandboxWidth + workspaceGap : 0))
  const capacity = Math.max(1, Math.floor((topicArea + topicGap) / (sizes.topicWidth + topicGap)))
  const groupCount = Math.max(0, area.groupCount || 0)
  const columns = Math.min(capacity, Math.max(1, groupCount))
  return { mode: settings.layoutMode, preset, sandboxWidth: sizes.sandboxWidth, topicWidth: sizes.topicWidth, topicVisibleTabs: settings.topicVisibleTabs, columns, stacked }
}
