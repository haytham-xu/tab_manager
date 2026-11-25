import { describe, expect, it } from 'vitest'
import { LAYOUT_PRESETS, closestLayoutPreset, resolveLayout } from '../src/core/layout'

const area = (width, height = 800, groupCount = 12) => ({ viewportWidth: width, width: width - 44, height: height - 113, groupCount })

describe('automatic window layouts', () => {
  it.each([
    [1280, 'compact'], [1360, 'compact'], [1440, 'laptop'], [1512, 'laptop'],
    [1728, 'desktop'], [1920, 'desktop'], [2440, 'qhd'], [2560, 'qhd'], [3440, 'ultrawide'],
  ])('selects the closest viewport preset at %ipx', (width, id) => {
    expect(closestLayoutPreset(width).id).toBe(id)
  })

  it.each([
    [1280, 2, 3], [1440, 2, 4], [1920, 3, 5], [2440, 4, 6], [2560, 4, 6], [3440, 6, 8],
  ])('fits the available topic area at %ipx with and without Sandbox', (width, onColumns, offColumns) => {
    expect(resolveLayout({ layoutMode: 'auto', sandboxVisible: true }, area(width)).columns).toBe(onColumns)
    expect(resolveLayout({ layoutMode: 'auto', sandboxVisible: false }, area(width)).columns).toBe(offColumns)
  })

  it('adjusts visible rows for the current height while retaining a usable minimum', () => {
    const short = resolveLayout({ layoutMode: 'auto' }, area(1280, 800, 5))
    const tall = resolveLayout({ layoutMode: 'auto' }, area(1280, 1080, 5))
    expect(short.topicVisibleTabs).toBe(3)
    expect(tall.topicVisibleTabs).toBe(5)
    expect(resolveLayout({ layoutMode: 'auto' }, { ...area(1280), height: 0 }).topicVisibleTabs).toBe(1)
    expect(tall.topicVisibleTabs).toBeLessThanOrEqual(tall.preset.topicVisibleTabs)
  })

  it('does not invent empty columns when there are only a few topics', () => {
    expect(resolveLayout({ layoutMode: 'auto', sandboxVisible: false }, area(3440, 1440, 2)).columns).toBe(2)
  })

  it('keeps manual dimensions stable across different windows', () => {
    const saved = { layoutMode: 'manual', sandboxWidth: 520, topicWidth: 340, topicVisibleTabs: 4 }
    for (const width of [1280, 2560, 3440]) {
      expect(resolveLayout(saved, area(width, 1440))).toMatchObject({ mode: 'manual', preset: null, sandboxWidth: 520, topicWidth: 340, topicVisibleTabs: 4 })
    }
  })

  it('resolves each window independently without replacing manual settings or presets', () => {
    const saved = { layoutMode: 'auto', sandboxWidth: 520, topicWidth: 340, topicVisibleTabs: 4 }
    const original = structuredClone(saved)
    const presets = structuredClone(LAYOUT_PRESETS)
    const small = resolveLayout(saved, area(1280))
    const large = resolveLayout(saved, area(3440, 1440))
    expect(small.sandboxWidth).toBe(480)
    expect(large.sandboxWidth).toBe(760)
    expect(resolveLayout(saved, area(1280))).toEqual(small)
    expect(saved).toEqual(original)
    expect(LAYOUT_PRESETS).toEqual(presets)
  })
})
