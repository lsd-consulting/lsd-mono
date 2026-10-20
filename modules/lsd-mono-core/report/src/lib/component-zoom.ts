// Zoom for the Components view (#105), with the same controls, keys and status messages as the
// sequence diagram's (#94). Each scenario keeps its own: the default is 100%, where names are
// 11px, and − and + step through the same ladder, keeping the middle of the view in place.
// Overview fits the whole drawing both ways (a component graph has no time axis to scroll along),
// down to OVERVIEW_MIN_ZOOM, and a click or tap in it goes back to 100% centred there.
// The mode (default, the user's own zoom, or Overview and where it goes back to) is the sequence
// diagram's ZoomMode, moved on by the same zoomModeAfter (#100). Like the sequence side, Overview
// fits again whenever its room changes (the side panel opening, a resize, a phone turned).
import { DEFAULT_ZOOM, OVERVIEW_MIN_ZOOM, stepZoom, type ZoomChange } from './diagram-view'
import { mountedComponents, onComponentResize } from './component-view'
import type { ZoomMode } from './diagram/state'
import { announceZoom, type ZoomAction, wheelStep } from './diagram/zoom-controls'
import { defaultMode, fittedWidthOf, zoomModeAfter } from './diagram/zoom-mode'
import { paintZoomControls, type ZoomShown } from './diagram/zoom-readout'

export interface ComponentZoom {
  zoom: number
  mode: ZoomMode
  /**
   * The room height Overview was fitted to. The mode keeps the width; a component graph fits
   * both ways, so the height is kept here.
   */
  fittedHeight: number
}

const zooms = new Map<string, ComponentZoom>()

/** The scenario's Components zoom; 100% and no Overview until it changes. */
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
  return { zoom: state.zoom, overview: state.mode.kind === 'overview' }
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

/** Whether Overview has anything to show: the drawing does not fit its room at 100%. */
export function componentOverviewNeeded(width: number, height: number, roomWidth: number, roomHeight: number): boolean {
  if (!(roomWidth > 0) || !(roomHeight > 0)) return false
  return width > roomWidth + 0.5 || height > roomHeight + 0.5
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
  announceZoom(statusOf(scroller), change)
}

/** The Zoom group's readout, limits and Overview button, from the scenario's state. */
export function syncComponentZoomControls(scroller: HTMLElement): void {
  const id = scroller.dataset.scenarioId ?? ''
  const drawn = mountedComponents(id)
  const group = scroller.closest('.comp-diagram')?.querySelector('.zoom-controls')
  if (!drawn || !group) return
  const room = roomOf(scroller)
  paintZoomControls(
    group,
    componentZoomShown(id),
    componentOverviewNeeded(drawn.width, drawn.height, room.width, room.height),
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

function reset(scroller: HTMLElement, centre?: { x: number; y: number }): void {
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  const at = centre ?? middleOf(scroller, state.zoom)
  state.mode = zoomModeAfter(state.mode, { kind: 'reset' })
  applyZoom(scroller, DEFAULT_ZOOM, at)
  say(scroller, { kind: 'default', zoom: DEFAULT_ZOOM })
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
  if (!componentOverviewNeeded(drawn.width, drawn.height, room.width, room.height)) {
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

/** What a Zoom button or key does to the Components view in [scroller]. */
export function runComponentZoom(scroller: HTMLElement, action: ZoomAction): void {
  const state = componentZoom(scroller.dataset.scenarioId ?? '')
  if (action === 'in' || action === 'out') step(scroller, action === 'in' ? 1 : -1)
  else if (action === 'reset') reset(scroller)
  else if (action === 'leave') leaveOverview(scroller)
  else if (state.mode.kind === 'overview') leaveOverview(scroller)
  else enterOverview(scroller)
}

export function isComponentScroll(el: Element): boolean {
  return el.classList.contains('comp-scroll')
}

/**
 * The Zoom group's buttons, Ctrl/Cmd+wheel, and a click or tap in Overview, for [scroller], and
 * Overview fitted again when its room changes.
 */
export function bindComponentZoom(scroller: HTMLElement): void {
  const id = scroller.dataset.scenarioId ?? ''
  const view = scroller.closest('.comp-diagram')
  view?.querySelectorAll<HTMLButtonElement>('.zoom-controls [data-zoom]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') return
      const action = btn.dataset.zoom
      if (action === 'in' || action === 'out' || action === 'reset' || action === 'overview') {
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
      if (state.mode.kind !== 'overview' || !svg) return
      ev.preventDefault()
      ev.stopPropagation()
      const box = svg.getBoundingClientRect()
      reset(scroller, { x: (ev.clientX - box.left) / state.zoom, y: (ev.clientY - box.top) / state.zoom })
    },
    true,
  )
  // An Overview kept from before this drawing was made fits once it is first measured, and again
  // whenever its room changes. A hidden view (width 0) waits until it is shown.
  let measured = false
  const refit = (): void => {
    if (scroller.clientWidth === 0) return
    const state = componentZoom(id)
    if (state.mode.kind === 'overview') {
      const fitted = measured ? (fittedWidthOf(state.mode) ?? 0) : 0
      if (overviewRoomChanged(fitted, state.fittedHeight, roomOf(scroller))) fitOverview(scroller)
    }
    measured = true
    syncComponentZoomControls(scroller)
  }
  onComponentResize(scroller, refit)
  refit()
}
