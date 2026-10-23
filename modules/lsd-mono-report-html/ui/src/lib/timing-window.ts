// The Timing view's waterfall window (#90b): which rows to keep in the DOM for a scroll position,
// the same idea as the diagram's virtualRowRange (layout.ts), for HTML rows whose heights are
// measured as they are drawn rather than laid out up front.

/** Up to this many waterfall rows the whole list is drawn, so the browser's find sees every row. */
export const WATERFALL_WINDOW_MIN_ROWS = 300

/** Rows drawn with the panel before the first measure: enough to fill a tall side panel. */
export const WATERFALL_FIRST_ROWS = 48

/** Pixels drawn above and below the visible part of the list, so a fast scroll finds rows ready. */
export const WATERFALL_OVERSCAN_PX = 600

/** A row's height before it has been drawn and measured: the CSS min-height of a one-line row. */
export const WATERFALL_ROW_ESTIMATE_PX = 26

/** Whether a waterfall of [rows] rows is windowed. */
export function windowsWaterfall(rows: number): boolean {
  return rows > WATERFALL_WINDOW_MIN_ROWS
}

/**
 * Row heights, measured where a row has been drawn and estimated elsewhere, and their running
 * offsets. offsets[i] is row i's top in the list; offsets[count] is the list's height.
 */
export class RowHeights {
  readonly count: number
  private readonly heights: Float64Array
  private readonly measured: Uint8Array
  private estimate: number
  private offsetCache: Float64Array | null = null

  constructor(count: number, estimate = WATERFALL_ROW_ESTIMATE_PX) {
    this.count = Math.max(0, Math.floor(count))
    this.heights = new Float64Array(this.count)
    this.measured = new Uint8Array(this.count)
    this.estimate = estimate > 0 ? estimate : WATERFALL_ROW_ESTIMATE_PX
  }

  /** Height of row [i]: its measure, or the estimate. */
  height(i: number): number {
    return this.measured[i] ? this.heights[i] : this.estimate
  }

  /** Record row [i]'s drawn height. True when it changed what the offsets say. */
  set(i: number, px: number): boolean {
    if (i < 0 || i >= this.count || !(px >= 0) || !Number.isFinite(px)) return false
    if (this.measured[i] && Math.abs(this.heights[i] - px) < 0.01) return false
    const before = this.height(i)
    this.heights[i] = px
    this.measured[i] = 1
    if (Math.abs(before - px) >= 0.01) {
      this.offsetCache = null
      return true
    }
    return false
  }

  /**
   * Forget every measure (the list changed width, so rows may wrap differently) and estimate the
   * rows not yet drawn again from [estimate].
   */
  reset(estimate = this.estimate): void {
    this.measured.fill(0)
    if (estimate > 0 && Number.isFinite(estimate)) this.estimate = estimate
    this.offsetCache = null
  }

  /** The estimate for undrawn rows. */
  setEstimate(px: number): boolean {
    if (!(px > 0) || !Number.isFinite(px) || Math.abs(px - this.estimate) < 0.01) return false
    this.estimate = px
    this.offsetCache = null
    return true
  }

  offsets(): Float64Array {
    if (this.offsetCache) return this.offsetCache
    const out = new Float64Array(this.count + 1)
    for (let i = 0; i < this.count; i++) out[i + 1] = out[i] + this.height(i)
    this.offsetCache = out
    return out
  }

  /** Row [i]'s top in the list. */
  top(i: number): number {
    return this.offsets()[Math.max(0, Math.min(this.count, i))]
  }

  /** The list's height. */
  total(): number {
    return this.offsets()[this.count]
  }
}

/** The first row whose bottom is below [y] (offsets as RowHeights.offsets), or count when none is. */
export function rowAt(offsets: ArrayLike<number>, y: number): number {
  const count = offsets.length - 1
  if (count <= 0) return 0
  let lo = 0
  let hi = count
  // Smallest i with offsets[i + 1] > y.
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid + 1] > y) hi = mid
    else lo = mid + 1
  }
  return lo
}

/**
 * Rows to draw, [start, end), for the visible part of the list, [top, bottom) in list pixels,
 * plus [overscan] pixels each way. A list scrolled out of view keeps the row at its nearer end,
 * so there is always at least one row when there are rows.
 */
export function waterfallRange(input: { offsets: ArrayLike<number>; top: number; bottom: number; overscan?: number }): {
  start: number
  end: number
} {
  const { offsets } = input
  const count = offsets.length - 1
  if (count <= 0) return { start: 0, end: 0 }
  const overscan = Math.max(0, input.overscan ?? WATERFALL_OVERSCAN_PX)
  const total = offsets[count]
  const top = Math.max(0, Math.min(total, input.top - overscan))
  const bottom = Math.max(top, Math.min(total, input.bottom + overscan))
  const start = Math.min(count - 1, rowAt(offsets, top))
  let end = rowAt(offsets, bottom)
  if (end < count && offsets[end] < bottom) end += 1
  return { start, end: Math.max(start + 1, Math.min(count, end)) }
}

/**
 * The visible part of a list, in its own pixels: the list's box against the boxes that clip it
 * (the window, and the side panel where that scrolls). A list below the view gives a span above
 * its top (negative), one above the view a span past its end, and clips that do not meet an
 * empty span.
 */
export function visibleSpan(
  list: { top: number; bottom: number },
  clips: readonly { top: number; bottom: number }[],
): { top: number; bottom: number } {
  let top = -Infinity
  let bottom = Infinity
  for (const c of clips) {
    top = Math.max(top, c.top)
    bottom = Math.min(bottom, c.bottom)
  }
  if (!Number.isFinite(top)) top = list.top
  if (!Number.isFinite(bottom)) bottom = list.bottom
  const from = top - list.top
  const to = bottom - list.top
  return { top: from, bottom: Math.max(from, to) }
}

/**
 * Above this many swim-lane bars the lanes are painted on one canvas per lane, with one real
 * button per lane that moves to the bar under the pointer or the keyboard (#90c). Up to it each
 * bar is its own button, as before.
 */
export const LANE_CANVAS_MIN_BARS = 300

/** Whether swim lanes with [bars] bars in all are painted on canvases. */
export function paintsLanes(bars: number): boolean {
  return bars > LANE_CANVAS_MIN_BARS
}

/** A bar's CSS min-width (timing.css .lane-bar), so the shortest call can still be pointed at. */
export const LANE_BAR_MIN_PX = 3

/**
 * Where a bar sits in a lane track [trackPx] wide, as .lane-bar does it: left and width as shares
 * of the scenario's [totalMs], the width at least LANE_BAR_MIN_PX.
 */
export function laneBarBox(
  startMs: number,
  spanMs: number,
  totalMs: number,
  trackPx: number,
): { x: number; w: number } {
  const total = totalMs > 0 ? totalMs : 0
  const x = total ? (startMs / total) * trackPx : 0
  const w = total ? (spanMs / total) * trackPx : 0
  return { x, w: Math.max(LANE_BAR_MIN_PX, w) }
}

/** The bar drawn on top at [x] (the last one covering it, as later buttons paint over earlier), or -1. */
export function laneBarAt(boxes: readonly { x: number; w: number }[], x: number): number {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]
    if (x >= b.x && x <= b.x + b.w) return i
  }
  return -1
}
