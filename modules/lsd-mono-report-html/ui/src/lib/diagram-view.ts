import type { DiagramEvent, MessageEvent, NoteEvent, Participant } from '../types'
import { escapeHtml } from './escape'
import { HEADER_BLOCK_H, MESSAGE_LABEL_RISE } from './layout'

/** Lowest level − and the wheel reach. */
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2.5
export const DEFAULT_ZOOM = 1
/**
 * The default view (first render, the % readout, and later resizes until the user zooms) shrinks
 * a diagram that is wider than its panel, but never enlarges one past 100%: a narrow diagram would
 * otherwise open with oversized text (#94).
 */
export const AUTO_FIT_MAX_ZOOM = 1
/**
 * The default view never goes below this: message labels are 11px in the drawing, so 95% keeps
 * them above 10 CSS px, and arrow targets keep their size. A wider diagram scrolls sideways, with
 * a cue that more lanes lie to the right. − still reaches MIN_ZOOM, and Overview goes lower.
 */
export const FIT_MIN_ZOOM = 0.95
/** Overview fits a wide diagram's whole width, but never below this (#94). */
export const OVERVIEW_MIN_ZOOM = 0.1
/** 1:1 (Shift+0, #120): the readable size, 100%, where labels are at their authored size. */
export const READABLE_ZOOM = 1

/**
 * Whether [zoom] is below the readable size. A Components fit there (its default view or
 * Overview) says so and points to 1:1, and a tap, click or Enter on the drawing goes to 1:1 (#120).
 */
export function belowReadable(zoom: number): boolean {
  return zoom < READABLE_ZOOM - 0.005
}
/** The levels + and − (and Ctrl/Cmd+wheel) step through, from MIN_ZOOM to MAX_ZOOM. */
export const ZOOM_LEVELS: readonly number[] = [
  0.25,
  0.33,
  0.5,
  0.67,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
  MAX_ZOOM,
]
/** Two levels this close are the same level: an overview scale is never exactly a preset. */
const SAME_LEVEL = 0.005

export interface ZoomViewport {
  scrollTop: number
  viewportHeight: number
  headerHeight: number
}

function clampZoom(scale: number, min = MIN_ZOOM): number {
  if (!Number.isFinite(scale)) return DEFAULT_ZOOM
  return Math.min(MAX_ZOOM, Math.max(min, scale))
}

/**
 * The next level on the ladder in [direction]. From a level off the ladder (95%, or an overview
 * scale) that is the nearest preset that way, so 95% + gives 100%. At either end it is [current].
 */
export function stepZoom(current: number, direction: 1 | -1): number {
  const next =
    direction > 0
      ? ZOOM_LEVELS.find((level) => level > current + SAME_LEVEL)
      : [...ZOOM_LEVELS].reverse().find((level) => level < current - SAME_LEVEL)
  return next ?? current
}

/** Whether + (1) or − (-1) would change [current]: the button is disabled when not. */
export function canStepZoom(current: number, direction: 1 | -1): boolean {
  return stepZoom(current, direction) !== current
}

/**
 * Overview's scale: the whole drawing's width in [viewportWidth], never below OVERVIEW_MIN_ZOOM,
 * and never larger than 100%. Unmeasured sizes give DEFAULT_ZOOM, like fitToWidthScale.
 */
export function overviewScale(contentWidth: number, viewportWidth: number): number {
  if (!(contentWidth > 0) || !(viewportWidth > 0)) return DEFAULT_ZOOM
  return Math.min(DEFAULT_ZOOM, Math.max(OVERVIEW_MIN_ZOOM, viewportWidth / contentWidth))
}

/**
 * Whether Overview (the fit) has anything to do at [zoom]: the drawing is wider than the
 * scrollport there, and Overview's scale is smaller (at the floor it cannot fit any more).
 */
export function overviewNeeded(contentWidth: number, viewportWidth: number, zoom = FIT_MIN_ZOOM): boolean {
  if (!(contentWidth > 0) || !(viewportWidth > 0)) return false
  return contentWidth * zoom > viewportWidth + 0.5 && overviewScale(contentWidth, viewportWidth) < zoom - 0.005
}

/** How many of the lanes at [laneXs] (lifelines, drawn px) lie within [left, left + width], ends included. */
export function lanesInView(laneXs: readonly number[], left: number, width: number): number {
  return laneXs.filter((x) => x >= left && x <= left + width).length
}

/** What a zoom change says in the status line: one message per change, with its context (#94). */
export type ZoomChange =
  | { kind: 'step'; zoom: number }
  | { kind: 'default'; zoom: number }
  | { kind: 'overview'; zoom: number; shown: number; total: number; unit?: 'lanes' | 'components' }
  | { kind: 'overview-off'; zoom: number }
  | { kind: 'fits'; zoom: number }
  | { kind: 'actual'; zoom: number }

/**
 * What a Components fit below the readable size says (#120), in its cue and its status line
 * alike: how to get to 1:1 by key, or on touch (a coarse pointer). Short enough for a 320px phone.
 */
export const TOO_SMALL_TEXT = 'Too small to read: press Shift+0'
export const TOO_SMALL_TEXT_TOUCH = 'Too small to read: tap 1:1'
/**
 * The drawing's description while a Components fit is too small to read (#120 round 2): the
 * visible cue is aria-hidden, so a screen reader on a page that opens there hears it from here.
 */
export const TOO_SMALL_DESCRIPTION = 'Too small to read. Press Shift+0, or Enter on an item, to view at actual size.'

export function tooSmallHint(coarse: boolean): string {
  return coarse ? TOO_SMALL_TEXT_TOUCH : TOO_SMALL_TEXT
}

export interface ZoomAnnouncementOptions {
  /** A fit below the readable size says so and how to get to 1:1 (the Components view, #120). */
  tooSmall?: boolean
  /** A touch screen. */
  coarse?: boolean
}

export function zoomAnnouncement(
  change: ZoomChange,
  { tooSmall = false, coarse = false }: ZoomAnnouncementOptions = {},
): string {
  const level = zoomLabel(change.zoom)
  const hint = tooSmall && belowReadable(change.zoom) ? `. ${tooSmallHint(coarse)}.` : ''
  switch (change.kind) {
    case 'step':
      return `Zoom ${level}`
    case 'actual':
      return `Zoom 1:1, ${level}`
    case 'default':
      return `Default zoom, ${level}${hint}`
    case 'overview':
      return change.shown >= change.total
        ? `Overview, ${level}, whole diagram${hint}`
        : `Overview, ${level}, ${change.shown} of ${change.total} ${change.unit ?? 'lanes'} shown${hint}`
    case 'overview-off':
      return `Overview off, zoom ${level}`
    case 'fits':
      return `Whole diagram already fits, zoom ${level}`
  }
}

/**
 * Scale that fits `contentWidth` into `viewportWidth`.
 * Non-positive sizes stay at 1 so a not-yet-laid-out scrollport does not jump.
 * Result is clamped to the same range as + and −.
 */
export function fitToWidthScale(contentWidth: number, viewportWidth: number): number {
  if (!(contentWidth > 0) || !(viewportWidth > 0)) return DEFAULT_ZOOM
  return clampZoom(viewportWidth / contentWidth)
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Box of the label drawn above an arrow. `arrowY` is the row's arrow line.
 * The box spans the arrow so the default view can require that whole label to stay on screen.
 */
export function messageLabelRect(input: { arrowY: number; x1: number; x2: number }): Rect {
  const left = Math.min(input.x1, input.x2)
  const right = Math.max(input.x1, input.x2)
  const width = Math.max(right - left, 24)
  return {
    x: left,
    y: input.arrowY - MESSAGE_LABEL_RISE,
    width,
    height: MESSAGE_LABEL_RISE,
  }
}

export function rectContains(outer: Rect, inner: Rect, epsilon = 0.01): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  )
}

export interface FittedView {
  scale: number
  /** Unscaled content origin of the visible body (under the sticky header). */
  originX: number
  originY: number
  visible: Rect
}

/**
 * The default view: the width fit, between FIT_MIN_ZOOM and AUTO_FIT_MAX_ZOOM, plus a scroll
 * origin that keeps `mustInclude` — the top message label — inside the visible body.
 * The sticky header height is the unscaled header block times that scale,
 * because the header SVG scales with the diagram.
 */
export function fittedView(input: {
  contentWidth: number
  viewportWidth: number
  viewportHeight: number
  mustInclude: Rect
  headerBlock?: number
}): FittedView {
  const scale = Math.max(
    FIT_MIN_ZOOM,
    Math.min(fitToWidthScale(input.contentWidth, input.viewportWidth), AUTO_FIT_MAX_ZOOM),
  )
  const headerCss = (input.headerBlock ?? HEADER_BLOCK_H) * scale
  const visibleW = input.viewportWidth > 0 ? input.viewportWidth / scale : input.contentWidth
  const bodyCss = Math.max(0, input.viewportHeight - headerCss)
  const visibleH = scale > 0 ? bodyCss / scale : 0
  const box = input.mustInclude
  let originX = 0
  let originY = 0
  if (box.y < originY) originY = box.y
  else if (box.y + box.height > originY + visibleH) originY = box.y
  if (box.x < originX) originX = box.x
  else if (box.x + box.width > originX + visibleW) originX = box.x + box.width - visibleW
  return {
    scale,
    originX,
    originY,
    visible: { x: originX, y: originY, width: visibleW, height: visibleH },
  }
}

/**
 * scrollLeft that brings [left, right] (CSS pixels of the drawing) inside a scrollport `view`
 * wide, moving as little as possible. A box wider than the view lines up its left edge.
 */
export function scrollportXFor(scrollLeft: number, view: number, left: number, right: number): number {
  const margin = 12
  if (right - left > view - 2 * margin) return Math.max(0, Math.round(left - margin))
  if (left < scrollLeft + margin) return Math.max(0, Math.round(left - margin))
  if (right > scrollLeft + view - margin) return Math.max(0, Math.round(right - view + margin))
  return scrollLeft
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(clampZoom(zoom, OVERVIEW_MIN_ZOOM) * 100)}%`
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

export function visibleParticipants(participants: Participant[], hiddenIds: ReadonlySet<string>): Participant[] {
  if (hiddenIds.size === 0) return participants.slice()
  return participants.filter((p) => !hiddenIds.has(p.id))
}

/** Column order after hiding. Preserves the original participant order. */
export function visibleColumnIds(participants: Participant[], hiddenIds: ReadonlySet<string>): string[] {
  return visibleParticipants(participants, hiddenIds).map((p) => p.id)
}

/**
 * True when the message cannot be drawn on the remaining columns.
 * Short arrows have one real endpoint. A message between two still-visible
 * participants stays (those columns reflow). A message that names a hidden
 * participant is omitted rather than pointed at the wrong lifeline.
 */
function messageNeedsHiddenColumn(msg: MessageEvent, hiddenIds: ReadonlySet<string>): boolean {
  if (hiddenIds.size === 0) return false
  if (msg.type === 'SHORT_INBOUND') return Boolean(msg.to) && hiddenIds.has(msg.to)
  if (msg.type === 'SHORT_OUTBOUND') return Boolean(msg.from) && hiddenIds.has(msg.from)
  return hiddenIds.has(msg.from) || hiddenIds.has(msg.to)
}

/** Anchored notes leave with their participant. Unanchored notes stay. */
function noteNeedsHiddenColumn(note: NoteEvent, hiddenIds: ReadonlySet<string>): boolean {
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

/** Where Find matched a row: its label or note text, its payload, or both. */
export type FindMatch = 'label' | 'payload' | 'both'

/**
 * How [event] matches [query]: its label or note text (rowMatchesQuery), or its payload when its
 * id is in [payloadHits], the messages whose payload matched (see diagram/payload-find).
 */
export function findMatch(
  event: DiagramEvent,
  query: string,
  payloadHits: ReadonlySet<string> = NO_PAYLOAD_HITS,
): FindMatch | null {
  const label = rowMatchesQuery(event, query)
  const payload = event.kind === 'message' && payloadHits.has(event.id)
  if (label && payload) return 'both'
  if (label) return 'label'
  return payload ? 'payload' : null
}

export const NO_PAYLOAD_HITS: ReadonlySet<string> = new Set()

export function matchingEventIds(events: DiagramEvent[], query: string): string[] {
  return events.filter((event) => rowMatchesQuery(event, query)).map((event) => event.id)
}

/** What Find knows about payloads, for the count: matches in them, still searching, or not loaded. */
export interface PayloadCount {
  /** Matches you can step to whose payload matched. */
  inPayloads?: number
  /** Payloads are still loading or being searched for this query. */
  pending?: boolean
  /** The payloads could not be loaded, so only labels and notes were searched. */
  failed?: boolean
}

/** One piece of the count: the match count, the payload matches, the hidden ones, or a status. */
export interface CountPart {
  kind: 'count' | 'payloads' | 'hidden' | 'status'
  text: string
}

/**
 * Live-region text in pieces (see searchCountLabel), so a narrow toolbar can leave one out of
 * sight while screen readers still hear it.
 */
export function searchCountParts(
  total: number,
  hidden: number,
  query: string,
  current = 0,
  payloads: PayloadCount = {},
): CountPart[] {
  if (!query.trim()) return []
  if (total === 0 && payloads.pending) return [{ kind: 'status', text: 'Searching payloads…' }]
  const noun = total === 1 ? 'match' : 'matches'
  const parts: CountPart[] = [
    { kind: 'count', text: current > 0 ? `${current} of ${total - hidden}` : `${total} ${noun}` },
  ]
  if (payloads.inPayloads) parts.push({ kind: 'payloads', text: `${payloads.inPayloads} in payloads` })
  if (hidden > 0) parts.push({ kind: 'hidden', text: `${hidden} on a hidden column` })
  if (payloads.pending) parts.push({ kind: 'status', text: 'searching payloads…' })
  if (payloads.failed) parts.push({ kind: 'status', text: 'payloads could not be loaded' })
  return parts
}

/**
 * Live-region text. Empty query is silent. Hidden-column hits are named, not only recoloured.
 * With a current match ([current], 1-based) it reads "2 of 5", counting the matches you can step to.
 * Payload matches are named ("2 of 5, 3 in payloads"), and so is a search still running.
 */
export function searchCountLabel(
  total: number,
  hidden: number,
  query: string,
  current = 0,
  payloads: PayloadCount = {},
): string {
  return searchCountParts(total, hidden, query, current, payloads)
    .map((part) => part.text)
    .join(', ')
}

/** The count as spans, one per piece, each after the first starting with its comma. Escaped. */
export function searchCountHtml(parts: readonly CountPart[]): string {
  return parts
    .map((part, i) => `<span class="find-count-${part.kind}">${escapeHtml(i ? `, ${part.text}` : part.text)}</span>`)
    .join('')
}

/**
 * Settle the width a fit (the default view or Overview) should fill. Zooming can add or remove the scrollport's
 * vertical scrollbar, which changes the width the drawing has, so a fit measured
 * before zooming can overflow by the scrollbar's width. `applyAt(width)` fits the
 * drawing to `width` and returns the scrollport's inner width afterwards. Prefers
 * the widest width that still fits once applied; the chosen fit is left applied.
 */
export function settleFitWidth(start: number, applyAt: (width: number) => number, maxPasses = 4): number {
  let width = start
  let best: number | null = null
  let last = Number.NaN
  for (let pass = 0; pass < maxPasses; pass++) {
    const room = applyAt(width)
    last = width
    if (room >= width) {
      best = width
      if (room === width) break
      width = room
      continue
    }
    if (best !== null) break
    width = room
  }
  const chosen = best ?? width
  if (last !== chosen) applyAt(chosen)
  return chosen
}
