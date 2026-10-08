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
/**
 * Section band geometry inside the section row. The band stays this size;
 * extra row height is padding under the band, not a taller painted separator.
 * Message labels rise MESSAGE_LABEL_RISE above the next row, so the default
 * pad keeps that label clear of the band (same 4px gap as TOP_LABEL_PAD).
 */
export const SECTION_BAND_Y = 8
export const SECTION_BAND_H = 32
export const SECTION_LABEL_GAP = 4
export const SECTION_AFTER_PAD = MESSAGE_LABEL_RISE + SECTION_LABEL_GAP
export const BOTTOM_PAD = 28
export const ACT_W = 12
/** Each nested activation sits this far right of its parent, as in PlantUML. */
export const ACT_NEST_DX = ACT_W / 2
/** A self-call loop leaves its lifeline at the row's y and comes back this far below. */
export const SELF_RETURN_DY = 22
export const DEFAULT_OVERSCAN = 6
/** Used when the scrollport has not been laid out yet (clientHeight 0). */
export const DEFAULT_VIEWPORT = 560

export const ROW_H = {
  message: 52,
  note: 40,
  divider: 36,
  section: SECTION_BAND_Y + SECTION_BAND_H + SECTION_AFTER_PAD,
  delay: 36,
  spacer: 24,
  // Lifeline keywords are not rows. The bar is pinned to the neighbouring arrows.
  activate: 0,
  deactivate: 0,
} as const

/** Fixed note card width — short notes still look like notes. */
export const NOTE_CARD_W = 140
export const NOTE_PAD_X = 10
export const NOTE_PAD_Y = 3
export const NOTE_LINE_H = 12
/**
 * Vertical gap between successive note card edges when each card is centred on its
 * row.y. With a 28px card this keeps ROW_H.note at 40 (28 + 12).
 */
export const NOTE_ROW_GAP = 12
/** Approx advance width for `.note-text` (10.5px, weight 600). */
export const NOTE_CHAR_W = 6
export const NOTE_CARD_MIN_H = 28

/**
 * Wrap note copy so it fits inside the card. Prefer word breaks; hard-split
 * overlong tokens so a single line never spills past the content width.
 */
export function wrapNoteLines(text: string): string[] {
  const raw = text.replace(/\s+/g, ' ').trim()
  if (!raw) return ['']
  const maxChars = Math.max(1, Math.floor((NOTE_CARD_W - 2 * NOTE_PAD_X) / NOTE_CHAR_W))
  const words = raw.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ''
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars))
      }
      continue
    }
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxChars) {
      current = next
    } else {
      if (current) lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

export interface NoteCardMetrics {
  width: number
  height: number
  lines: string[]
}

/**
 * Card size for a note: width stays ~140; height grows with wrapped lines.
 * Placement (over, left, right) is layout only. It is not printed in the card.
 */
export function noteCardMetrics(text: string): NoteCardMetrics {
  const lines = wrapNoteLines(text)
  const textH = Math.max(1, lines.length) * NOTE_LINE_H
  const height = Math.max(NOTE_CARD_MIN_H, textH + 2 * NOTE_PAD_Y)
  return { width: NOTE_CARD_W, height, lines }
}

/** Short arrow stub length from lifeline toward the diagram edge (not a fake participant). */
export const SHORT_STUB = 48
export const EDGE_INSET = 16
/** Smallest gap kept between drawn content and the diagram's left or right edge. */
export const EDGE_MARGIN = 8
/** Approx advance width for `.msg-label` (11.5px, weight 550), used to size the frame. */
export const MSG_CHAR_W = 6.6
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
  /** 0 for an outermost bar, 1 for a bar opened inside it, and so on. */
  depth: number
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

/**
 * How far this event paints above its row origin.
 * Message labels use MESSAGE_LABEL_RISE (baseline plus glyph). Notes are
 * centred on row.y, so half the card sticks up. Dividers and delays do not
 * rise past SECTION_AFTER_PAD.
 */
export function contentRise(event: DiagramEvent): number {
  switch (event.kind) {
    case 'message':
      return MESSAGE_LABEL_RISE
    case 'note':
      return noteCardMetrics(event.text).height / 2
    default:
      return 0
  }
}

/**
 * Section row height. The band is fixed; the rest is padding so the next
 * drawn event's raised content sits SECTION_LABEL_GAP below the band.
 * Activate/deactivate rows have no height, so the caller passes the next
 * event that actually paints.
 */
export function sectionRowHeight(next: DiagramEvent | undefined): number {
  const bandBottom = SECTION_BAND_Y + SECTION_BAND_H
  let pad = SECTION_AFTER_PAD
  if (next) pad = Math.max(pad, contentRise(next) + SECTION_LABEL_GAP)
  return bandBottom + pad
}

export function eventRowHeight(event: DiagramEvent): number {
  switch (event.kind) {
    case 'note':
      return Math.max(ROW_H.note, noteCardMetrics(event.text).height + NOTE_ROW_GAP)
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

/** Next event that paints a row. Activate/deactivate are zero-height markers. */
function nextDrawnEvent(events: DiagramEvent[], after: number): DiagramEvent | undefined {
  for (let i = after + 1; i < events.length; i++) {
    const event = events[i]
    if (event.kind === 'activate' || event.kind === 'deactivate') continue
    return event
  }
  return undefined
}

/** Gap between a note card's top edge and the lowest point of the arrow or note above it. */
export const NOTE_CLEARANCE = 6

/**
 * Lowest point a drawn row paints below its y. A self-call loop comes back
 * SELF_RETURN_DY below the row, plus its arrowhead. A note is centred on y.
 * Null for rows a note cannot collide with in practice.
 */
function paintedBottom(row: LayoutRow): number | null {
  const event = row.event
  if (event.kind === 'message') {
    const selfCall = event.from !== '' && event.from === event.to
    return row.y + (selfCall ? SELF_RETURN_DY : 0) + 4
  }
  if (event.kind === 'note') return row.y + noteCardMetrics(event.text).height / 2
  return null
}

/**
 * Rows stacked from y = 0. Sections are ordinary rows — they do not reset y or activations.
 * A note is centred on its row's y, so half the card rises into the row above.
 * When that would cover the arrow or note above (a tall note after a self-call),
 * the note moves down until its top edge clears it.
 */
export function layoutRows(events: DiagramEvent[]): LayoutRow[] {
  const ordered = sortEventsByCreatedAt(events)
  const rows: LayoutRow[] = []
  let y = TOP_LABEL_PAD
  let lastDrawn: LayoutRow | undefined
  for (let index = 0; index < ordered.length; index++) {
    const event = ordered[index]
    const height = event.kind === 'section'
      ? sectionRowHeight(nextDrawnEvent(ordered, index))
      : eventRowHeight(event)
    if (event.kind === 'note' && lastDrawn) {
      const above = paintedBottom(lastDrawn)
      if (above != null) {
        const top = y - noteCardMetrics(event.text).height / 2
        y += Math.max(0, above + NOTE_CLEARANCE - top)
      }
    }
    const row = { index, y, height, event }
    rows.push(row)
    if (height > 0) lastDrawn = row
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
 *
 * Capture writes `activate` after the incoming message and `deactivate` after
 * the last message. The bar uses that previous message's y, the arrow line.
 * When that message is a self-call on the same lifeline, the bar uses the
 * point where the loop comes back, so a nested bar starts under the arrowhead.
 * With no previous message, the zero-height keyword sits on the following row.
 *
 * Bars come back parents first, so painting them in order draws a nested bar
 * on top of the one it sits in.
 */
function arrowY(rows: LayoutRow[], index: number, participantId: string): number {
  for (let i = index - 1; i >= 0; i--) {
    const event = rows[i].event
    if (event.kind !== 'message') continue
    const selfCall = event.from === participantId && event.to === participantId
    return rows[i].y + (selfCall ? SELF_RETURN_DY : 0)
  }
  return rows[index].y
}

export function activationSpans(rows: LayoutRow[], endY: number): ActivationSpan[] {
  const spans: ActivationSpan[] = []
  const open = new Map<string, { y: number; colour?: string; depth: number }[]>()
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const event = row.event
    if (event.kind === 'activate') {
      const stack = open.get(event.participantId) ?? []
      const colour = event.colour?.trim() ? event.colour : undefined
      stack.push({ y: arrowY(rows, index, event.participantId), colour, depth: stack.length })
      open.set(event.participantId, stack)
    } else if (event.kind === 'deactivate') {
      const stack = open.get(event.participantId) ?? []
      const opened = stack.pop()
      const y = arrowY(rows, index, event.participantId)
      spans.push({
        participantId: event.participantId,
        y0: opened?.y ?? y,
        y1: y,
        colour: opened?.colour,
        depth: opened?.depth ?? 0,
      })
      open.set(event.participantId, stack)
    }
  }
  for (const [participantId, stack] of open) {
    while (stack.length) {
      const opened = stack.pop()!
      spans.push({ participantId, y0: opened.y, y1: endY, colour: opened.colour, depth: opened.depth })
    }
  }
  // Stable sort: same-depth bars keep their order.
  return spans.sort((a, b) => a.depth - b.depth)
}

/** Depth of the innermost bar on this lifeline that covers y (ends inclusive), or -1 for none. */
export function activationDepthAt(
  spans: readonly Pick<ActivationSpan, 'participantId' | 'y0' | 'y1' | 'depth'>[],
  participantId: string,
  y: number,
): number {
  let depth = -1
  for (const span of spans) {
    if (span.participantId === participantId && span.y0 <= y && y <= span.y1 && span.depth > depth) depth = span.depth
  }
  return depth
}
