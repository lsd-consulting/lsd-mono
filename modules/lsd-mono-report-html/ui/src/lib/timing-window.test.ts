import { describe, expect, it } from 'vitest'
import {
  LANE_BAR_MIN_PX,
  LANE_CANVAS_MIN_BARS,
  RowHeights,
  WATERFALL_OVERSCAN_PX,
  WATERFALL_ROW_ESTIMATE_PX,
  WATERFALL_WINDOW_MIN_ROWS,
  laneBarAt,
  laneBarBox,
  paintsLanes,
  rowAt,
  visibleSpan,
  waterfallRange,
  windowsWaterfall,
} from './timing-window'

describe('waterfall window (#90b)', () => {
  it('windows only a long waterfall, and paints only many lane bars', () => {
    expect(windowsWaterfall(WATERFALL_WINDOW_MIN_ROWS)).toBe(false)
    expect(windowsWaterfall(WATERFALL_WINDOW_MIN_ROWS + 1)).toBe(true)
    expect(paintsLanes(LANE_CANVAS_MIN_BARS)).toBe(false)
    expect(paintsLanes(LANE_CANVAS_MIN_BARS + 1)).toBe(true)
  })

  it('estimates rows not yet measured, and keeps offsets for the measured ones', () => {
    const h = new RowHeights(4)
    expect(h.total()).toBe(4 * WATERFALL_ROW_ESTIMATE_PX)
    expect(h.set(1, 40)).toBe(true)
    expect(h.set(1, 40)).toBe(false)
    expect(h.set(2, WATERFALL_ROW_ESTIMATE_PX)).toBe(false) // measured, but the offsets say the same
    expect(h.height(2)).toBe(WATERFALL_ROW_ESTIMATE_PX)
    expect([...h.offsets()]).toEqual([0, 26, 66, 92, 118])
    expect(h.top(-1)).toBe(0)
    expect(h.top(99)).toBe(118)
    // Out of range, negative or not a number: ignored.
    expect(h.set(-1, 10)).toBe(false)
    expect(h.set(4, 10)).toBe(false)
    expect(h.set(0, Number.NaN)).toBe(false)
    expect(h.set(0, Infinity)).toBe(false)
  })

  it('takes a new estimate, and forgets measures on reset', () => {
    const h = new RowHeights(3, -5)
    expect(h.height(0)).toBe(WATERFALL_ROW_ESTIMATE_PX)
    expect(h.setEstimate(30)).toBe(true)
    expect(h.setEstimate(30)).toBe(false)
    expect(h.setEstimate(0)).toBe(false)
    expect(h.total()).toBe(90)
    h.set(0, 50)
    expect(h.total()).toBe(110)
    h.reset()
    expect(h.total()).toBe(90)
    h.reset(20)
    expect(h.total()).toBe(60)
    h.reset(Number.NaN)
    expect(h.total()).toBe(60)
    expect(new RowHeights(-3).total()).toBe(0)
  })

  it('finds the row at a height', () => {
    const offsets = [0, 10, 30, 60]
    expect(rowAt(offsets, -5)).toBe(0)
    expect(rowAt(offsets, 0)).toBe(0)
    expect(rowAt(offsets, 9.9)).toBe(0)
    expect(rowAt(offsets, 10)).toBe(1)
    expect(rowAt(offsets, 59)).toBe(2)
    expect(rowAt(offsets, 60)).toBe(3)
    expect(rowAt([0], 5)).toBe(0)
  })

  it('draws the visible rows and the overscan each way', () => {
    const offsets = new RowHeights(1000, 20).offsets()
    // Rows 100 to 129 visible, 30 rows of overscan each way.
    expect(waterfallRange({ offsets, top: 2000, bottom: 2600, overscan: 600 })).toEqual({ start: 70, end: 160 })
    expect(waterfallRange({ offsets, top: 2010, bottom: 2590, overscan: 0 })).toEqual({ start: 100, end: 130 })
    expect(waterfallRange({ offsets, top: 0, bottom: 500 })).toEqual({
      start: 0,
      end: (500 + WATERFALL_OVERSCAN_PX) / 20,
    })
    expect(waterfallRange({ offsets, top: 19_900, bottom: 21_000, overscan: 0 })).toEqual({ start: 995, end: 1000 })
  })

  it('keeps one row at the nearer end of a list scrolled out of view, and none for an empty list', () => {
    const offsets = new RowHeights(100, 20).offsets()
    expect(waterfallRange({ offsets, top: -900, bottom: -900, overscan: 0 })).toEqual({ start: 0, end: 1 })
    expect(waterfallRange({ offsets, top: 5000, bottom: 5000, overscan: 0 })).toEqual({ start: 99, end: 100 })
    expect(waterfallRange({ offsets: [0], top: 0, bottom: 100 })).toEqual({ start: 0, end: 0 })
  })

  it('sees the part of the list inside every clip, in its own pixels', () => {
    const list = { top: -500, bottom: 4500 }
    expect(visibleSpan(list, [{ top: 0, bottom: 900 }])).toEqual({ top: 500, bottom: 1400 })
    expect(
      visibleSpan(list, [
        { top: 0, bottom: 900 },
        { top: 56, bottom: 1200 },
      ]),
    ).toEqual({ top: 556, bottom: 1400 })
    // No clips: all of it. Below the view: above its top, so the overscan reaches its first rows.
    expect(visibleSpan(list, [])).toEqual({ top: 0, bottom: 5000 })
    expect(visibleSpan({ top: 1000, bottom: 2000 }, [{ top: 0, bottom: 900 }])).toEqual({ top: -1000, bottom: -100 })
    // Clipped away entirely: an empty span.
    expect(
      visibleSpan(list, [
        { top: 0, bottom: 100 },
        { top: 200, bottom: 300 },
      ]),
    ).toEqual({ top: 700, bottom: 700 })
  })
})

describe('painted swim lanes (#90c)', () => {
  it('places a bar as .lane-bar does, at least its min width', () => {
    expect(laneBarBox(250, 500, 1000, 400)).toEqual({ x: 100, w: 200 })
    expect(laneBarBox(0, 0.01, 1000, 400)).toEqual({ x: 0, w: LANE_BAR_MIN_PX })
    expect(laneBarBox(10, 10, 0, 400)).toEqual({ x: 0, w: LANE_BAR_MIN_PX })
  })

  it('finds the bar drawn on top under the pointer', () => {
    const boxes = [
      { x: 0, w: 100 },
      { x: 50, w: 10 },
      { x: 200, w: 3 },
    ]
    expect(laneBarAt(boxes, 55)).toBe(1)
    expect(laneBarAt(boxes, 20)).toBe(0)
    expect(laneBarAt(boxes, 203)).toBe(2)
    expect(laneBarAt(boxes, 150)).toBe(-1)
    expect(laneBarAt([], 0)).toBe(-1)
  })
})
