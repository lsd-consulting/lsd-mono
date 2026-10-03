import { describe, expect, it } from 'vitest'
import {
  densityBins,
  fractionFromPointer,
  minimapViewportRange,
  scrubScrollTop,
  scrollTopFromMinimapFraction,
} from './minimap'

describe('minimapViewportRange', () => {
  it('tracks the visible body as a fraction of content height', () => {
    expect(
      minimapViewportRange({
        scrollTop: 0,
        viewportHeight: 200,
        headerHeight: 40,
        contentHeight: 1000,
      }),
    ).toEqual({ top: 0, height: 0.16 })

    expect(
      minimapViewportRange({
        scrollTop: 400,
        viewportHeight: 200,
        headerHeight: 40,
        contentHeight: 1000,
      }),
    ).toEqual({ top: 0.4, height: 0.16 })
  })

  it('clamps when the window would run past the end', () => {
    const range = minimapViewportRange({
      scrollTop: 900,
      viewportHeight: 200,
      headerHeight: 40,
      contentHeight: 1000,
    })
    expect(range.top).toBe(0.9)
    expect(range.height).toBeCloseTo(0.1, 5)
  })
})

describe('scrollTopFromMinimapFraction', () => {
  it('moves the detail window when the strip is activated', () => {
    expect(
      scrollTopFromMinimapFraction({
        fractionY: 0.5,
        viewportHeight: 200,
        headerHeight: 40,
        contentHeight: 1000,
      }),
    ).toBe(500)

    expect(
      scrollTopFromMinimapFraction({
        fractionY: 1,
        viewportHeight: 200,
        headerHeight: 40,
        contentHeight: 1000,
      }),
    ).toBe(840)
  })
})

describe('densityBins', () => {
  it('buckets row positions without allocating one slot per event beyond the bin count', () => {
    const ys = [0, 10, 20, 500, 510, 990]
    expect(densityBins(ys, 1000, 10)).toEqual([3, 0, 0, 0, 0, 2, 0, 0, 0, 1])
    expect(densityBins(ys, 1000, 4).length).toBe(4)
  })
})

describe('fractionFromPointer and scrubScrollTop', () => {
  it('maps pointer Y into the track and nudges by nearly one viewport', () => {
    expect(fractionFromPointer(150, 100, 200)).toBe(0.25)
    expect(
      scrubScrollTop({
        scrollTop: 100,
        direction: 1,
        viewportHeight: 200,
        headerHeight: 40,
        contentHeight: 1000,
      }),
    ).toBe(100 + 160 * 0.85)
  })
})
