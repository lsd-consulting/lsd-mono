import type { DiagramEvent } from '../types'

/** Diagram geometry in CSS pixels. 1 unit = 1 px so scroll math matches the SVG. */
export const COL_GAP = 140
export const LEFT_PAD = 72
export const HEADER_BLOCK_H = 56
/**
 * Message labels are drawn above the arrow (baseline 8px, plus glyph ascent).
 * The first row used to start at y=0, so that label sat outside the SVG viewBox
 * and Fit — which pins the view to the content origin — clipped it.
 */
export const MESSAGE_LABEL_RISE = 20
/** First-row offset so the label box is inside the body, not on the clip edge. */
export const TOP_LABEL_PAD = MESSAGE_LABEL_RISE + 4
export const BOTTOM_PAD = 28
export const ACT_W = 12
export const DEFAULT_OVERSCAN = 6
/** Used when the scrollport has not been laid out yet (clientHeight 0). */
export const DEFAULT_VIEWPORT = 560

export const ROW_H = {
  message: 52,
  note: 40,
  divider: 36,
  section: 48,
  delay: 36,
  spacer: 24,
  activate: 8,
  deactivate: 8,
} as const

/** Short arrow stub length from lifeline toward the diagram edge (not a fake participant). */
export const SHORT_STUB = 48
export const EDGE_INSET = 16
export const DEFAULT_SPACER_H = ROW_H.spacer
export const MIN_SPACER_H = 12
export const MAX_SPACER_H = 240

export interface LayoutRow {
  index: number
  /** Top of the row in body coordinates (0 = first event, below the sticky header). */
  y: number
  height: number
  event: DiagramEvent
}

export interface RowSpan {
  y: number
  height: number
}

export interface VirtualRange {
  /** Inclusive. */
  start: number
  /** Exclusive. */
  end: number
}

export interface ActivationSpan {
  participantId: string
  y0: number
  y1: number
  /** From the opening activate event. Absent means the default bar. */
  colour?: string
}

/**
 * When any event has `createdAt`, order by that ISO instant before layout.
 * Untimed events keep capture order and sort after timed ones. No timestamps → identity.
 */
export function sortEventsByCreatedAt(events: DiagramEvent[]): DiagramEvent[] {
  if (!events.some((event) => event.createdAt)) return events
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const ta = a.event.createdAt
      const tb = b.event.createdAt
      if (ta && tb && ta !== tb) return ta < tb ? -1 : 1
      if (ta && !tb) return -1
      if (!ta && tb) return 1
      return a.index - b.index
    })
    .map((item) => item.event)
}

export function eventRowHeight(event: DiagramEvent): number {
  switch (event.kind) {
    case 'note':
      return ROW_H.note
    case 'divider':
      return ROW_H.divider
    case 'section':
      return ROW_H.section
    case 'delay':
      return ROW_H.delay
    case 'spacer': {
      const h = event.heightPx
      if (h == null || Number.isNaN(h)) return DEFAULT_SPACER_H
      return Math.min(MAX_SPACER_H, Math.max(MIN_SPACER_H, h))
    }
    case 'activate':
      return ROW_H.activate
    case 'deactivate':
      return ROW_H.deactivate
    default:
      return ROW_H.message
  }
}

/** Rows stacked from y = 0. Sections are ordinary rows — they do not reset y or activations. */
export function layoutRows(events: DiagramEvent[]): LayoutRow[] {
  const ordered = sortEventsByCreatedAt(events)
  const rows: LayoutRow[] = []
  let y = TOP_LABEL_PAD
  for (let index = 0; index < ordered.length; index++) {
    const event = ordered[index]
    const height = eventRowHeight(event)
    rows.push({ index, y, height, event })
    y += height
  }
  return rows
}

export function diagramWidth(participantCount: number): number {
  return LEFT_PAD * 2 + Math.max(participantCount - 1, 1) * COL_GAP
}

export function bodyHeight(rows: LayoutRow[]): number {
  if (!rows.length) return BOTTOM_PAD
  const last = rows[rows.length - 1]
  return last.y + last.height + BOTTOM_PAD
}

/**
 * Window of rows to paint.
 *
 * `rows` must be sorted by ascending `y` (as from [layoutRows]).
 * `scrollTop` is the diagram scrollport's scrollTop. The sticky header occupies
 * `headerHeight` pixels of the viewport, so the visible body slice is
 * `[scrollTop, scrollTop + viewportHeight - headerHeight)`.
 * `overscan` is a row count added on each side.
 */
export function virtualRowRange(input: {
  rows: RowSpan[]
  scrollTop: number
  viewportHeight: number
  overscan?: number
  headerHeight?: number
}): VirtualRange {
  const { rows } = input
  const n = rows.length
  if (n === 0) return { start: 0, end: 0 }

  const overscan = Math.max(0, input.overscan ?? 0)
  const headerHeight = Math.max(0, input.headerHeight ?? 0)
  const scrollTop = Math.max(0, input.scrollTop)
  const visibleHeight = Math.max(0, input.viewportHeight - headerHeight)
  const viewTop = scrollTop
  const viewBottom = scrollTop + visibleHeight

  let first = n
  for (let i = 0; i < n; i++) {
    if (rows[i].y + rows[i].height > viewTop) {
      first = i
      break
    }
  }
  if (first === n) {
    return { start: Math.max(0, n - overscan), end: n }
  }

  let last = first
  for (let i = first; i < n; i++) {
    if (rows[i].y >= viewBottom) break
    last = i
  }

  return {
    start: Math.max(0, first - overscan),
    end: Math.min(n, last + 1 + overscan),
  }
}

/**
 * Activation bars across the whole event list.
 * A section (or any non-lifeline event) does not push or pop the stack.
 */
export function activationSpans(rows: LayoutRow[], endY: number): ActivationSpan[] {
  const spans: ActivationSpan[] = []
  const open = new Map<string, { y: number; colour?: string }[]>()
  for (const row of rows) {
    const event = row.event
    if (event.kind === 'activate') {
      const stack = open.get(event.participantId) ?? []
      const colour = event.colour?.trim() ? event.colour : undefined
      stack.push({ y: row.y, colour })
      open.set(event.participantId, stack)
    } else if (event.kind === 'deactivate') {
      const stack = open.get(event.participantId) ?? []
      const opened = stack.pop()
      spans.push({
        participantId: event.participantId,
        y0: opened?.y ?? row.y,
        y1: row.y,
        colour: opened?.colour,
      })
      open.set(event.participantId, stack)
    }
  }
  for (const [participantId, stack] of open) {
    while (stack.length) {
      const opened = stack.pop()!
      spans.push({ participantId, y0: opened.y, y1: endY, colour: opened.colour })
    }
  }
  return spans
}
