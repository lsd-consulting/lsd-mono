import type { DiagramEvent, MessageEvent } from '../types'
import { MESSAGE_LABEL_RISE } from './layout'
import { eventHiddenByColumns, type Rect } from './diagram-view'

/** WCAG 2.5.8 minimum target, in CSS pixels. The arrow stroke stays thin. */
export const MIN_HIT_CSS = 24

export interface MessagePlace {
  id: string
  /** 1-based index among drawn message events, not among painted rows. */
  posinset: number
  /** Full drawn message count. Never the virtual window length. */
  setsize: number
  /** Payload present, so the arrow is a button. */
  focusable: boolean
}

export interface HitBox {
  left: number
  top: number
  width: number
  height: number
}

export interface DiagramKeyAction {
  type: 'move' | 'open' | 'noop'
  messageId?: string
}

/** Messages that are still drawn, in diagram order. Hidden columns are omitted. */
export function messagePlaces(events: DiagramEvent[], hiddenIds: ReadonlySet<string>): MessagePlace[] {
  const drawn = events.filter(
    (event): event is MessageEvent => event.kind === 'message' && !eventHiddenByColumns(event, hiddenIds),
  )
  const setsize = drawn.length
  return drawn.map((event, index) => ({
    id: event.id,
    posinset: index + 1,
    setsize,
    focusable: event.data !== undefined && event.data !== null,
  }))
}

export function focusablePlaces(places: MessagePlace[]): MessagePlace[] {
  return places.filter((place) => place.focusable)
}

function resolveActive(stops: MessagePlace[], activeId: string | null): string {
  if (activeId && stops.some((stop) => stop.id === activeId)) return activeId
  return stops[0].id
}

function moveStop(stops: MessagePlace[], activeId: string, delta: 1 | -1): string {
  const index = stops.findIndex((stop) => stop.id === activeId)
  const next = Math.max(0, Math.min(stops.length - 1, (index < 0 ? 0 : index) + delta))
  return stops[next].id
}

/**
 * One tab stop: only the active message is tabindex 0.
 * Arrow keys move that stop. Enter and Space open the same inspector as a click.
 * Keys outside the diagram are ignored here so scenario navigation still works.
 */
function knownActive(stops: MessagePlace[], activeId: string | null): string | null {
  if (activeId && stops.some((stop) => stop.id === activeId)) return activeId
  return null
}

export function diagramKeyAction(input: {
  key: string
  places: MessagePlace[]
  activeId: string | null
  inDiagram: boolean
}): DiagramKeyAction {
  if (!input.inDiagram) return { type: 'noop' }
  const stops = focusablePlaces(input.places)
  if (!stops.length) return { type: 'noop' }
  const active = knownActive(stops, input.activeId)
  // No current arrow: the first Down/Enter enters at the start, Up at the end.
  if (input.key === 'ArrowDown') {
    return { type: 'move', messageId: active ? moveStop(stops, active, 1) : stops[0].id }
  }
  if (input.key === 'ArrowUp') {
    return { type: 'move', messageId: active ? moveStop(stops, active, -1) : stops[stops.length - 1].id }
  }
  if (input.key === 'Enter' || input.key === ' ') {
    return { type: 'open', messageId: active ?? stops[0].id }
  }
  return { type: 'noop' }
}

/** Roving tabindex. Exactly one focusable message is in the tab order. */
export function tabindexFor(messageId: string, activeId: string | null, places: MessagePlace[]): 0 | -1 {
  const stops = focusablePlaces(places)
  if (!stops.some((stop) => stop.id === messageId)) return -1
  return messageId === resolveActive(stops, activeId) ? 0 : -1
}

/**
 * The focused button was removed by the virtual window.
 * Prefer the next focusable message that is still painted; if the window moved
 * up, the previous painted one. When nothing in the window can take focus,
 * return the logical next id so a later scroll can bring that arrow back.
 */
export function replacementFocus(
  activeId: string,
  places: MessagePlace[],
  paintedIds: ReadonlySet<string>,
): string | null {
  const stops = focusablePlaces(places)
  if (!stops.length) return null
  const index = stops.findIndex((stop) => stop.id === activeId)
  if (index < 0) return stops.find((stop) => paintedIds.has(stop.id))?.id ?? stops[0].id
  if (paintedIds.has(activeId)) return activeId
  for (let i = index + 1; i < stops.length; i++) {
    if (paintedIds.has(stops[i].id)) return stops[i].id
  }
  for (let i = index - 1; i >= 0; i--) {
    if (paintedIds.has(stops[i].id)) return stops[i].id
  }
  return stops[Math.min(index + 1, stops.length - 1)].id
}

/** Dialog close puts focus back on the arrow that opened it. */
export function focusTargetAfterClose(invokerId: string | null): string | null {
  return invokerId
}

/**
 * Arrow Y of the previous and next focusable message, in content pixels.
 * Used to stop a 24px hit box from covering the neighbour's centre.
 */
export function focusableNeighbors(
  rows: { y: number; event: DiagramEvent }[],
  hiddenIds: ReadonlySet<string>,
): Map<string, { prevArrowY?: number; nextArrowY?: number }> {
  const focusable = new Set(focusablePlaces(messagePlaces(rows.map((row) => row.event), hiddenIds)).map((place) => place.id))
  const arrows = rows.filter((row) => row.event.kind === 'message' && focusable.has(row.event.id))
  const neighbors = new Map<string, { prevArrowY?: number; nextArrowY?: number }>()
  arrows.forEach((row, index) => {
    neighbors.set(row.event.id, {
      prevArrowY: index > 0 ? arrows[index - 1].y : undefined,
      nextArrowY: index < arrows.length - 1 ? arrows[index + 1].y : undefined,
    })
  })
  return neighbors
}

/**
 * Invisible CSS-pixel hit box over an arrow and its label.
 * Grows to 24px around the arrow centre unless that would cross the midpoint
 * to the previous or next target. The stroke is not part of this box.
 * When the row is shorter than 24px, the smaller box is the spacing exception:
 * a 24px circle on this centre still does not cover the neighbour's centre.
 */
export function messageHitBox(input: {
  label: Rect
  zoom: number
  viewTop: number
  prevArrowY?: number
  nextArrowY?: number
}): HitBox {
  const zoom = input.zoom > 0 && Number.isFinite(input.zoom) ? input.zoom : 1
  const arrowY = input.label.y + input.label.height
  const cx = (input.label.x + input.label.width / 2) * zoom
  const cy = (arrowY - input.viewTop) * zoom
  const labelLeft = input.label.x * zoom
  const labelTop = (input.label.y - input.viewTop) * zoom
  const labelRight = labelLeft + input.label.width * zoom
  const labelBottom = labelTop + input.label.height * zoom

  let left = Math.min(labelLeft, cx - MIN_HIT_CSS / 2)
  let right = Math.max(labelRight, cx + MIN_HIT_CSS / 2)
  let top = Math.min(labelTop, cy - MIN_HIT_CSS / 2)
  let bottom = Math.max(labelBottom, cy + MIN_HIT_CSS / 2)

  if (input.prevArrowY != null) {
    const mid = ((input.prevArrowY + arrowY) / 2 - input.viewTop) * zoom
    if (top < mid) top = mid
  }
  if (input.nextArrowY != null) {
    const mid = ((input.nextArrowY + arrowY) / 2 - input.viewTop) * zoom
    if (bottom > mid) bottom = mid
  }
  if (top > cy) top = cy
  if (bottom < cy) bottom = cy
  if (right < left) right = left

  return {
    left: roundCss(left),
    top: roundCss(top),
    width: roundCss(right - left),
    height: roundCss(bottom - top),
  }
}

/** A 24px circle on `center` does not contain `other` when this is true. */
export function circleClearsCenter(center: number, other: number, diameter = MIN_HIT_CSS): boolean {
  return Math.abs(center - other) >= diameter / 2 - 0.01
}

export function hitBoxContains(box: HitBox, x: number, y: number): boolean {
  return x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height
}

/** Sticky participant header height. Focus scrolls inside the padding, not under the header. */
export function scrollPaddingTop(headerCss: number): number {
  return Math.max(0, headerCss)
}

/**
 * scrollTop that puts the label above this arrow at the top of the visible body.
 * The label sits MESSAGE_LABEL_RISE above the arrow, same inset Fit already keeps.
 * Header clearance is scroll-padding, not a second subtraction here: the virtual
 * window already treats scrollTop as the start of the body under the sticky header.
 */
export function focusScrollTop(arrowY: number, zoom: number): number {
  const scale = zoom > 0 && Number.isFinite(zoom) ? zoom : 1
  return Math.max(0, roundCss((arrowY - MESSAGE_LABEL_RISE) * scale))
}

/**
 * Zoom and Fit animate the scroll when motion is allowed, and jump when it is not.
 * The scale is still a scale: columns are not restacked for text size.
 */
export function zoomScrollBehavior(prefersReducedMotion: boolean): 'auto' | 'smooth' {
  return prefersReducedMotion ? 'auto' : 'smooth'
}

/**
 * Find is the equivalent path for an undersized arrow: Enter on a query opens
 * the first drawn match that has a payload, the same inspector as a click.
 */
export function findOpensMessage(
  events: DiagramEvent[],
  query: string,
  hiddenIds: ReadonlySet<string>,
): string | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  for (const event of events) {
    if (event.kind !== 'message') continue
    if (eventHiddenByColumns(event, hiddenIds)) continue
    if (event.data == null) continue
    if (!event.label.toLowerCase().includes(q)) continue
    return event.id
  }
  return null
}

function roundCss(value: number): number {
  return Math.round(value * 100) / 100
}
