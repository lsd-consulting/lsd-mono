// Zoom for the Components view (#105), with the same controls, keys and status messages as the
// sequence diagram's (#94). Each scenario keeps its own. The default is a true overview (#120):
// the whole graph both ways (a component graph has no time axis to scroll along), never above
// 100% and never below OVERVIEW_MIN_ZOOM, fitted again as its room changes until the user zooms.
// − and + step through the same ladder, keeping the middle of the view in place. Overview is the
// same fit from a zoom of the user's own, with Esc (or Overview again) back to it, and 1:1 (Shift+0) is the readable
// 100%, centred on the selected or focused link, the point clicked, or the busiest component.
// While a fit is below the readable size it says so (a cue, and the status line), and a tap,
// click or Enter on the drawing goes to 1:1 there rather than hitting a tiny target.
// The mode (default, the user's own zoom, or Overview and where it goes back to) is the sequence
// diagram's ZoomMode, moved on by the same zoomModeAfter (#100). Like the sequence side, Overview
// fits again whenever its room changes (a resize, a phone turned, the side panel opening); the
// default view does too, but never smaller while the side panel is open (#120).
import {
  DEFAULT_ZOOM,
  OVERVIEW_MIN_ZOOM,
  READABLE_ZOOM,
  belowReadable,
  stepZoom,
  tooSmallDescription,
  tooSmallHint,
  type ZoomChange,
} from './diagram-view'
import { isCoarsePointer } from './media'
import { mountedComponents, onComponentResize, tooSmallDescriptionId } from './component-view'
import type { ZoomMode } from './diagram/state'
import { announceZoom, type ZoomAction, wheelStep } from './diagram/zoom-controls'
import { defaultMode, fittedWidthOf, zoomModeAfter } from './diagram/zoom-mode'
import { paintZoomControls, type ZoomShown } from './diagram/zoom-readout'

export interface ComponentZoom {
  zoom: number
  mode: ZoomMode
  /**
   * The room height the default view or Overview was fitted to. The mode keeps the width; a
   * component graph fits both ways, so the height is kept here.
   */
  fittedHeight: number
}

const zooms = new Map<string, ComponentZoom>()

/** The scenario's Components zoom: the default view (fitted once measured) until it changes. */
export function componentZoom(scenarioId: string): ComponentZoom {
  let state = zooms.get(scenarioId)
  if (!state) {
    state = { zoom: DEFAULT_ZOOM, mode: defaultMode(), fittedHeight: 0 }
    zooms.set(scenarioId, state)
  }
  return state
}

export function componentZoomShown(scenarioId: string): ZoomShown {
  const state = componentZoom(scenarioId)
  return { zoom: state.zoom, overview: state.mode.kind === 'overview', fitted: state.mode.kind !== 'zoomed' }
}

/** Whether [id]'s Components view is in Overview. */
export function inComponentOverview(scenarioId: string): boolean {
  return componentZoom(scenarioId).mode.kind === 'overview'
}

/**
 * Whether Overview, fitted to a room [fitted] wide and [fittedHeight] tall, needs fitting again in
 * [room]: a change of more than 1px either way. An unmeasured fit (0) always does.
 */
export function overviewRoomChanged(
  fitted: number,
  fittedHeight: number,
  room: { width: number; height: number },
): boolean {
  return !(fitted > 0) || Math.abs(room.width - fitted) > 1 || Math.abs(room.height - fittedHeight) > 1
}

/**
 * Overview's scale: the whole drawing ([width] × [height], drawn px) in the room the scrollport
 * has, never below OVERVIEW_MIN_ZOOM and never above 100%. Unmeasured sizes give 100%.
 */
export function componentOverviewScale(width: number, height: number, roomWidth: number, roomHeight: number): number {
  if (!(width > 0) || !(height > 0) || !(roomWidth > 0) || !(roomHeight > 0)) return DEFAULT_ZOOM
  return Math.min(DEFAULT_ZOOM, Math.max(OVERVIEW_MIN_ZOOM, Math.min(roomWidth / width, roomHeight / height)))
}

/**
 * Whether Overview (the fit) has anything to do at [zoom]: the drawing does not fit its room
 * there, and the fit's scale is smaller (at the floor it cannot fit any more).
 */
export function componentOverviewNeeded(
  width: number,
  height: number,
  roomWidth: number,
  roomHeight: number,
  zoom = DEFAULT_ZOOM,
): boolean {
  if (!(roomWidth > 0) || !(roomHeight > 0)) return false
  const fits = width * zoom <= roomWidth + 0.5 && height * zoom <= roomHeight + 0.5
  return !fits && componentOverviewScale(width, height, roomWidth, roomHeight) < zoom - 0.005
}

/**
 * The node with the most links to or from it (the first such, in graph order): where 1:1
 * centres a fitted view with nothing selected or focused (#120).
 */
export function busiestNode(graph: {
  nodes: readonly { id: string }[]
  edges: readonly { from: string; to: string }[]
}): string | null {
  const counts = new Map<string, number>()
  for (const edge of graph.edges) {
    counts.set(edge.from, (counts.get(edge.from) ?? 0) + 1)
    if (edge.to !== edge.from) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1)
  }
  let best: string | null = null
  for (const node of graph.nodes) {
    if (best == null || (counts.get(node.id) ?? 0) > (counts.get(best) ?? 0)) best = node.id
  }
  return best
}

/**
 * The room the drawing has: the scrollport's width, and the tallest it may grow (its max-height),
 * inside its borders. A scrollport with no height limit (print) has its own height.
 */
function roomOf(scroller: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(scroller)
  const across = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) || 0
  const down = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) || 0
  const tallest = parseFloat(style.maxHeight)
  const height = Number.isFinite(tallest) ? tallest - down : scroller.clientHeight
  return { width: scroller.getBoundingClientRect().width - across, height }
}

/** The status line the view's changes are said in: the diagram heading's. */
function statusOf(scroller: HTMLElement): Element | null {
  return scroller.closest('.diagram-panel')?.querySelector('.diagram-view-status') ?? null
}

function say(scroller: HTMLElement, change: ZoomChange): void {
  announceZoom(statusOf(scroller), change, { tooSmall: true, coarse: isCoarsePointer() })
}

/** Whether [id]'s Components view is a fit (the default view or Overview) below the readable size. */
export function componentTooSmall(scenarioId: string): boolean {
  const state = componentZoom(scenarioId)
  return state.mode.kind !== 'zoomed' && belowReadable(state.zoom)
}

/** What the view says after its zoom when it is too small to read, else nothing (#120). */
export function componentTooSmallSaid(scenarioId: string): string {
  return componentTooSmall(scenarioId) ? `. ${tooSmallHint(isCoarsePointer())}.` : ''
}

/**
 * While the fit is too small to read, the drawing is described by the hidden text that says what
 * to do (the visible cue is aria-hidden), so a screen reader hears it on reaching the drawing,
 * also on a page that opens on Components (#120 round 2). Otherwise it has no description.
 */
function describeTooSmall(scroller: HTMLElement, scenarioId: string): void {
  const svg = scroller.querySelector('svg.component-diagram')
  if (!svg) return
  if (componentTooSmall(scenarioId)) {
    // Worded for the pointer in use now: Shift+0 and Enter by key, a tap on touch.
    const text = document.getElementById(tooSmallDescriptionId(scenarioId))
    const said = tooSmallDescription(isCoarsePointer())
    if (text && text.textContent !== said) text.textContent = said
    svg.setAttribute('aria-describedby', tooSmallDescriptionId(scenarioId))
  } else svg.removeAttribute('aria-describedby')
}

/** The Zoom group's readout, limits and Overview button, from the scenario's state. */
export function syncComponentZoomControls(scroller: HTMLElement): void {
  const id = scroller.dataset.scenarioId ?? ''
  const drawn = mountedComponents(id)
  const group = scroller.closest('.comp-diagram')?.querySelector('.zoom-controls')
  if (!drawn || !group) return
  const room = roomOf(scroller)
  const state = componentZoom(id)
  describeTooSmall(scroller, id)
  paintZoomControls(
    group,
    componentZoomShown(id),
    state.mode.kind === 'overview' ||
      componentOverviewNeeded(drawn.width, drawn.height, room.width, room.height, state.zoom),
  )
}

/** The drawn point (unscaled px) in the middle of what the scrollport shows. */
function middleOf(scroller: HTMLElement, zoom: number): { x: number; y: number } {
  return {
    x: (scroller.scrollLeft + scroller.clientWidth / 2) / zoom,
    y: (scroller.scrollTop + scroller.clientHeight / 2) / zoom,
  }
}

/** Draw at [zoom], with the drawn point [centre] in the middle of the scrollport when given. */
function applyZoom(scroller: HTMLElement, zoom: number, centre?: { x: number; y: number }): void {
  const id = scroller.dataset.scenarioId ?? ''
  const drawn = mountedComponents(id)
  if (!drawn) return
  componentZoom(id).zoom = zoom
  scroller.style.setProperty('--comp-w', `${drawn.width * zoom}px`)
  scroller.style.setProperty('--comp-h', `${drawn.height * zoom}px`)
  if (centre) {
    scroller.scrollLeft = centre.x * zoom - scroller.clientWidth / 2
    scroller.scrollTop = centre.y * zoom - scroller.clientHeight / 2
  }
  syncComponentZoomControls(scroller)
  // The edge cues follow on the scroll event; a zoom that does not scroll needs them now.
  scroller.dispatchEvent(new Event('scroll'))
}

/** In Overview: the components wholly in view, and all of them. */
function componentsShown(scroller: HTMLElement): { shown: number; total: number } {
  const box = scroller.getBoundingClientRect()
  const nodes = [...scroller.querySelectorAll('.component-node')].map((node) => node.getBoundingClientRect())
  const shown = nodes.filter(
    (node) =>
      node.left >= box.left - 1 &&
      node.right <= box.right + 1 &&
      node.top >= box.top - 1 &&
      node.bottom <= box.bottom + 1,
  )
  return { shown: shown.length, total: nodes.length }
}

function step(scroller: HTMLElement, direction: 1 | -1): void {
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  const next = stepZoom(state.zoom, direction)
  if (next === state.zoom) return
  const wasOverview = state.mode.kind === 'overview'
  const centre = middleOf(scroller, state.zoom)
  state.mode = zoomModeAfter(state.mode, { kind: 'step' })
  applyZoom(scroller, next, centre)
  say(scroller, { kind: wasOverview ? 'overview-off' : 'step', zoom: next })
}

/** Back to the default view: the whole graph fitted afresh (#120). */
function reset(scroller: HTMLElement): void {
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  state.mode = zoomModeAfter(state.mode, { kind: 'reset' })
  fitOverview(scroller)
  say(scroller, { kind: 'default', zoom: state.zoom })
}

/** The middle of [el] in drawn px (unscaled, from the drawing's top left). */
function centreOf(scroller: HTMLElement, el: Element, zoom: number): { x: number; y: number } | null {
  const svg = scroller.querySelector('.component-diagram')
  if (!svg) return null
  const at = svg.getBoundingClientRect()
  const box = el.getBoundingClientRect()
  if (!(box.width > 0) && !(box.height > 0)) return null
  return { x: (box.left + box.width / 2 - at.left) / zoom, y: (box.top + box.height / 2 - at.top) / zoom }
}

/**
 * Where 1:1 centres (#120): the link with focus, else the selected one, else the point clicked,
 * else (in a fitted view) the busiest component, else the middle of what is on screen.
 */
function actualSizeCentre(scroller: HTMLElement, point?: { x: number; y: number }): { x: number; y: number } {
  const id = scroller.dataset.scenarioId ?? ''
  const state = componentZoom(id)
  const focused = document.activeElement?.closest('.edge-group')
  const link = focused && scroller.contains(focused) ? focused : scroller.querySelector('.edge-group.is-selected')
  const atLink = link ? centreOf(scroller, link, state.zoom) : null
  if (atLink) return atLink
  if (point) return point
  const graph = mountedComponents(id)?.graph
  const busiest = state.mode.kind !== 'zoomed' && graph ? busiestNode(graph) : null
  const node = busiest
    ? [...scroller.querySelectorAll<SVGGElement>('.component-node')].find((el) => el.dataset.component === busiest)
    : undefined
  return (node && centreOf(scroller, node, state.zoom)) ?? middleOf(scroller, state.zoom)
}

/** 1:1: the readable size, as a zoom of the user's own (out of Overview without going back). */
function actualSize(scroller: HTMLElement, point?: { x: number; y: number }): void {
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  const centre = actualSizeCentre(scroller, point)
  state.mode = zoomModeAfter(state.mode, { kind: 'step' })
  applyZoom(scroller, READABLE_ZOOM, centre)
  say(scroller, { kind: 'actual', zoom: READABLE_ZOOM })
}

/** Fit the whole drawing, from its top left, and keep the room it was fitted to. */
function fitOverview(scroller: HTMLElement): void {
  const id = scroller.dataset.scenarioId ?? ''
  const drawn = mountedComponents(id)
  if (!drawn) return
  const room = roomOf(scroller)
  const state = componentZoom(id)
  state.mode = zoomModeAfter(state.mode, { kind: 'fitted', width: room.width })
  state.fittedHeight = room.height
  applyZoom(scroller, componentOverviewScale(drawn.width, drawn.height, room.width, room.height))
  scroller.scrollLeft = 0
  scroller.scrollTop = 0
}

function enterOverview(scroller: HTMLElement): void {
  const id = scroller.dataset.scenarioId ?? ''
  const drawn = mountedComponents(id)
  const state = componentZoom(id)
  if (!drawn || state.mode.kind === 'overview') return
  const room = roomOf(scroller)
  if (!componentOverviewNeeded(drawn.width, drawn.height, room.width, room.height, state.zoom)) {
    // Shift+1 (the button is disabled then) still gets an answer.
    say(scroller, { kind: 'fits', zoom: state.zoom })
    return
  }
  const at = { zoom: state.zoom, left: scroller.scrollLeft, top: scroller.scrollTop }
  state.mode = zoomModeAfter(state.mode, { kind: 'enter-overview', at })
  fitOverview(scroller)
  say(scroller, { kind: 'overview', zoom: state.zoom, unit: 'components', ...componentsShown(scroller) })
}

function leaveOverview(scroller: HTMLElement): void {
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  if (state.mode.kind !== 'overview') return
  const saved = state.mode.saved
  state.mode = zoomModeAfter(state.mode, { kind: 'leave-overview' })
  applyZoom(scroller, saved.zoom)
  scroller.scrollLeft = saved.left
  scroller.scrollTop = saved.top
  say(scroller, { kind: 'overview-off', zoom: saved.zoom })
}

/** In Overview, or a default view too small to read: a click, tap or Enter goes to 1:1 there. */
function tooSmallOrOverview(scenarioId: string): boolean {
  return componentZoom(scenarioId).mode.kind === 'overview' || componentTooSmall(scenarioId)
}

/** What a Zoom button or key does to the Components view in [scroller]. */
export function runComponentZoom(scroller: HTMLElement, action: ZoomAction): void {
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  if (action === 'in' || action === 'out') step(scroller, action === 'in' ? 1 : -1)
  else if (action === 'reset') reset(scroller)
  else if (action === 'leave') leaveOverview(scroller)
  else if (action === 'actual') actualSize(scroller)
  else if (state.mode.kind === 'overview') leaveOverview(scroller)
  else enterOverview(scroller)
}

/**
 * The side panel opening narrows the default view's room; fitting that would shrink the drawing
 * under the panel's open item (#120), so the zoom holds while the panel is open, and the room it
 * was fitted to is kept so that closing the panel finds it unchanged. A larger fit still happens,
 * and Overview, which the user asked for, still fits.
 */
function heldWhilePanelOpen(scroller: HTMLElement, room: { width: number; height: number }): boolean {
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  const drawn = mountedComponents(scroller.dataset.scenarioId ?? '')
  if (state.mode.kind !== 'default' || !drawn || !measured.has(scroller)) return false
  if (!scroller.closest('.shell')?.classList.contains('with-inspector')) return false
  return componentOverviewScale(drawn.width, drawn.height, room.width, room.height) < state.zoom - 0.005
}

/** Scrollports whose fit has been measured once since they were drawn. */
const measured = new WeakSet<HTMLElement>()

/**
 * The default view and an Overview kept from before this drawing was made fit once first
 * measured, and again whenever their room changes; a zoom of the user's own is kept as it is.
 * A hidden view (width 0) waits until it is shown. Called on resize, and by the view switch so
 * that what it says has the zoom the view is shown at.
 */
export function refitComponentZoom(scroller: HTMLElement): void {
  if (scroller.clientWidth === 0) return
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  if (state.mode.kind !== 'zoomed') {
    const fitted = measured.has(scroller) ? (fittedWidthOf(state.mode) ?? 0) : 0
    const room = roomOf(scroller)
    if (overviewRoomChanged(fitted, state.fittedHeight, room) && !heldWhilePanelOpen(scroller, room)) {
      fitOverview(scroller)
    }
  }
  measured.add(scroller)
  syncComponentZoomControls(scroller)
}

export function isComponentScroll(el: Element): boolean {
  return el.classList.contains('comp-scroll')
}

/**
 * The Zoom group's buttons, Ctrl/Cmd+wheel, and a click, tap or Enter in Overview or a fit too
 * small to read, for [scroller], and the fit kept up with its room.
 */
export function bindComponentZoom(scroller: HTMLElement): void {
  const id = scroller.dataset.scenarioId ?? ''
  const view = scroller.closest('.comp-diagram')
  view?.querySelectorAll<HTMLButtonElement>('.zoom-controls [data-zoom]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') return
      const action = btn.dataset.zoom
      if (action === 'in' || action === 'out' || action === 'reset' || action === 'overview' || action === 'actual') {
        runComponentZoom(scroller, action)
      }
    })
  })
  scroller.addEventListener(
    'wheel',
    (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return
      ev.preventDefault()
      const by = wheelStep(scroller, ev.deltaY, ev.deltaMode)
      if (by) step(scroller, by)
    },
    { passive: false },
  )
  // Capture, so the click does not also open the link under it.
  scroller.addEventListener(
    'click',
    (ev) => {
      const state = componentZoom(id)
      const svg = scroller.querySelector('.component-diagram')
      if (!svg || !tooSmallOrOverview(id)) return
      ev.preventDefault()
      ev.stopPropagation()
      const box = svg.getBoundingClientRect()
      actualSize(scroller, { x: (ev.clientX - box.left) / state.zoom, y: (ev.clientY - box.top) / state.zoom })
    },
    true,
  )
  // Enter or Space on a link in a fit too small to read: 1:1 centred on it (actualSizeCentre takes
  // the focused link), as a click there does, rather than opening the side panel (#120).
  scroller.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      if (!(ev.target as Element | null)?.closest?.('.edge-group') || !tooSmallOrOverview(id)) return
      ev.preventDefault()
      ev.stopPropagation()
      actualSize(scroller)
    },
    true,
  )
  const refit = (): void => refitComponentZoom(scroller)
  onComponentResize(scroller, refit)
  refit()
}
