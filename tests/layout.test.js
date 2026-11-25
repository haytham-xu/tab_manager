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

  it('keeps the visible tab limit independent of viewport, height and layout mode', () => {
    for (const mode of ['auto', 'manual']) for (const width of [1280, 2440, 3440]) for (const height of [520, 1440]) {
      expect(resolveLayout({ layoutMode: mode, topicVisibleTabs: 8 }, area(width, height, 5)).topicVisibleTabs).toBe(8)
    }
  })

  it('changing visible tabs cannot change widths, columns or stacking', () => {
    for (const mode of ['auto', 'manual']) {
      const saved = { layoutMode: mode, sandboxWidth: 520, topicWidth: 340 }
      const baseline = resolveLayout({ ...saved, topicVisibleTabs: 1 }, area(1920))
      for (const count of [3, 8, 20]) {
        expect(resolveLayout({ ...saved, topicVisibleTabs: count }, area(1920))).toMatchObject({
          mode: baseline.mode, sandboxWidth: baseline.sandboxWidth, topicWidth: baseline.topicWidth, columns: baseline.columns, stacked: baseline.stacked, topicVisibleTabs: count,
        })
      }
    }
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
