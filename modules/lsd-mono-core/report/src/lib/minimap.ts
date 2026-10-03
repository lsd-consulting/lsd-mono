/**
 * Cheap overview strip for a tall sequence diagram.
 * Pure math only: the DOM uses one canvas plus a viewport marker, never one node per event.
 */

export interface MinimapRange {
  /** 0–1: top of the visible body as a fraction of content height. */
  top: number
  /** 0–1: visible body height as a fraction of content height. */
  height: number
}

/**
 * Viewport highlight for the minimap track.
 * `scrollTop` and sizes are CSS pixels of the scrollport (already zoomed).
 * The sticky header is excluded from the visible body, matching virtualRowRange.
 */
export function minimapViewportRange(input: {
  scrollTop: number
  viewportHeight: number
  headerHeight: number
  contentHeight: number
}): MinimapRange {
  const content = Math.max(1, input.contentHeight)
  const body = Math.max(0, input.viewportHeight - Math.max(0, input.headerHeight))
  const scrollTop = Math.max(0, input.scrollTop)
  let top = scrollTop / content
  let height = body / content
  if (top > 1) top = 1
  if (height > 1 - top) height = Math.max(0, 1 - top)
  if (height <= 0 && body > 0) {
    // Fully scrolled past tiny content: pin the marker at the bottom edge.
    top = Math.max(0, 1 - Math.min(1, body / content))
    height = Math.min(1, body / content)
  }
  return { top, height }
}

/**
 * scrollTop that places the point at `fractionY` (0–1 along the strip) at the
 * top of the visible body. Clamped so the window cannot leave the content.
 */
export function scrollTopFromMinimapFraction(input: {
  fractionY: number
  viewportHeight: number
  headerHeight: number
  contentHeight: number
}): number {
  const content = Math.max(0, input.contentHeight)
  const body = Math.max(0, input.viewportHeight - Math.max(0, input.headerHeight))
  const maxScroll = Math.max(0, content - body)
  const fraction = Number.isFinite(input.fractionY) ? input.fractionY : 0
  return Math.max(0, Math.min(maxScroll, fraction * content))
}

/**
 * Density samples for the strip. Each bin is the count of row tops that fall in
 * that vertical slice. Callers draw bars from this; the array length is the node
 * budget, not the event count.
 */
export function densityBins(rowYs: readonly number[], contentHeight: number, binCount: number): number[] {
  const bins = Math.max(1, Math.floor(binCount))
  const counts = new Array<number>(bins).fill(0)
  const height = Math.max(1, contentHeight)
  for (const y of rowYs) {
    if (!(y >= 0) || y > height) continue
    const index = Math.min(bins - 1, Math.floor((y / height) * bins))
    counts[index]++
  }
  return counts
}

/** Pointer Y inside the track → 0–1 fraction down the diagram. */
export function fractionFromPointer(clientY: number, trackTop: number, trackHeight: number): number {
  if (!(trackHeight > 0)) return 0
  return Math.max(0, Math.min(1, (clientY - trackTop) / trackHeight))
}

/**
 * Arrow keys on the focused strip nudge the window by one viewport body.
 * Reduced-motion callers still jump; there is nothing to animate here.
 */
export function scrubScrollTop(input: {
  scrollTop: number
  direction: 1 | -1
  viewportHeight: number
  headerHeight: number
  contentHeight: number
}): number {
  const body = Math.max(1, input.viewportHeight - Math.max(0, input.headerHeight))
  const content = Math.max(0, input.contentHeight)
  const maxScroll = Math.max(0, content - body)
  const step = body * 0.85
  return Math.max(0, Math.min(maxScroll, input.scrollTop + input.direction * step))
}
