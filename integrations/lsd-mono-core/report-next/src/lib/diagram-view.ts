import type { DiagramEvent, MessageEvent, NoteEvent, Participant } from '../types'

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2.5
export const DEFAULT_ZOOM = 1
/** Button and wheel step, as a fraction of 100%. */
export const ZOOM_STEP = 0.1

export interface ZoomViewport {
  scrollTop: number
  viewportHeight: number
  headerHeight: number
}

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/** One zoom step. Positive deltaY (wheel down) zooms out. */
export function zoomFromWheel(current: number, deltaY: number): number {
  if (deltaY > 0) return stepZoom(current, -1)
  if (deltaY < 0) return stepZoom(current, 1)
  return clampZoom(current)
}

export function stepZoom(current: number, direction: 1 | -1): number {
  const pct = Math.round(current * 100) + direction * Math.round(ZOOM_STEP * 100)
  return clampZoom(pct / 100)
}

/**
 * Scale that fits `contentWidth` into `viewportWidth`.
 * Non-positive sizes stay at 1 so a not-yet-laid-out scrollport does not jump.
 * Result is clamped to the same range as the zoom buttons.
 */
export function fitToWidthScale(contentWidth: number, viewportWidth: number): number {
  if (!(contentWidth > 0) || !(viewportWidth > 0)) return DEFAULT_ZOOM
  return clampZoom(viewportWidth / contentWidth)
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`
}

/**
 * Scroll math stays in unscaled row pixels. The DOM is scaled by `zoom`,
 * so divide CSS pixels before `virtualRowRange`.
 */
export function unscaledViewport(input: ZoomViewport & { zoom: number }): ZoomViewport {
  const zoom = input.zoom > 0 && Number.isFinite(input.zoom) ? input.zoom : 1
  return {
    scrollTop: Math.max(0, input.scrollTop) / zoom,
    viewportHeight: Math.max(0, input.viewportHeight) / zoom,
    headerHeight: Math.max(0, input.headerHeight) / zoom,
  }
}

export function visibleParticipants(
  participants: Participant[],
  hiddenIds: ReadonlySet<string>,
): Participant[] {
  if (hiddenIds.size === 0) return participants.slice()
  return participants.filter((p) => !hiddenIds.has(p.id))
}

/** Column order after hiding. Preserves the original participant order. */
export function visibleColumnIds(
  participants: Participant[],
  hiddenIds: ReadonlySet<string>,
): string[] {
  return visibleParticipants(participants, hiddenIds).map((p) => p.id)
}

/**
 * True when the message cannot be drawn on the remaining columns.
 * Short arrows have one real endpoint. A message between two still-visible
 * participants stays (those columns reflow). A message that names a hidden
 * participant is omitted rather than pointed at the wrong lifeline.
 */
export function messageNeedsHiddenColumn(msg: MessageEvent, hiddenIds: ReadonlySet<string>): boolean {
  if (hiddenIds.size === 0) return false
  if (msg.type === 'SHORT_INBOUND') return Boolean(msg.to) && hiddenIds.has(msg.to)
  if (msg.type === 'SHORT_OUTBOUND') return Boolean(msg.from) && hiddenIds.has(msg.from)
  return hiddenIds.has(msg.from) || hiddenIds.has(msg.to)
}

/** Anchored notes leave with their participant. Unanchored notes stay. */
export function noteNeedsHiddenColumn(note: NoteEvent, hiddenIds: ReadonlySet<string>): boolean {
  if (hiddenIds.size === 0 || !note.over) return false
  return hiddenIds.has(note.over)
}

export function eventHiddenByColumns(event: DiagramEvent, hiddenIds: ReadonlySet<string>): boolean {
  if (hiddenIds.size === 0) return false
  if (event.kind === 'message') return messageNeedsHiddenColumn(event, hiddenIds)
  if (event.kind === 'note') return noteNeedsHiddenColumn(event, hiddenIds)
  if (event.kind === 'activate' || event.kind === 'deactivate') return hiddenIds.has(event.participantId)
  return false
}

export function rowMatchesQuery(event: DiagramEvent, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  if (event.kind === 'message') return event.label.toLowerCase().includes(q)
  if (event.kind === 'note') return event.text.toLowerCase().includes(q)
  return false
}

export function matchingEventIds(events: DiagramEvent[], query: string): string[] {
  return events.filter((event) => rowMatchesQuery(event, query)).map((event) => event.id)
}

export function classifySearchHits(
  events: DiagramEvent[],
  query: string,
  hiddenIds: ReadonlySet<string>,
): { total: number; hidden: number } {
  let total = 0
  let hidden = 0
  for (const event of events) {
    if (!rowMatchesQuery(event, query)) continue
    total++
    if (eventHiddenByColumns(event, hiddenIds)) hidden++
  }
  return { total, hidden }
}

/** Live-region text. Empty query is silent. Hidden-column hits are named, not only recoloured. */
export function searchCountLabel(total: number, hidden: number, query: string): string {
  if (!query.trim()) return ''
  const noun = total === 1 ? 'match' : 'matches'
  const base = `${total} ${noun}`
  if (hidden > 0) return `${base}, ${hidden} on a hidden column`
  return base
}
