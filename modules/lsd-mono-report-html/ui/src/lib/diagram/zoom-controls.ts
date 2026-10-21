// Zoom controls (#94): what − and +, the readout, Overview and Ctrl/Cmd+wheel do, and the one
// status message each change makes. − and + step through ZOOM_LEVELS, the % readout goes back to
// the default view, and Overview fits the whole drawing's width (down to OVERVIEW_MIN_ZOOM) until
// it is turned off. The buttons are drawn in zoom-readout.ts; the keys are in zoom-keys.ts.
import { scrollBehavior } from '../media'
import { frameOf, messageLabelBox } from './geometry'
import { diagramState, diagramView } from './state'
import { zoomModeAfter } from './zoom-mode'
import {
  lanesInView,
  overviewNeeded,
  stepZoom,
  visibleParticipants,
  zoomAnnouncement,
  type ZoomChange,
} from '../diagram-view'
import { laneIndex, xFor } from './shapes'
import { revealMessageX } from './window'
import { syncZoomControls } from './zoom-readout'
import { commitZoom, fitOverview, refitDiagram, showDefaultView } from './zoom'

/** How long the status line stays empty before it says again what it last said. */
const REPEAT_GAP_MS = 100

/**
 * Say [change] in the diagram's polite status line. The same words again (the % readout pressed
 * twice) would be no change to a screen reader, so the line empties first and speaks a moment later.
 */
function announce(scrollport: HTMLElement, change: ZoomChange): void {
  announceZoom(scrollport.closest('.seq-diagram')?.querySelector('.participant-filter-status') ?? null, change)
}

/** Say [change] in [status], a polite status line; the same words again after a short gap. */
export function announceZoom(status: Element | null, change: ZoomChange): void {
  announceStatus(status, zoomAnnouncement(change))
}

/** Say [text] in [status], a polite status line; the same words again after a short gap. */
export function announceStatus(status: Element | null, text: string): void {
  if (!status) return
  const pending = repeats.get(status)
  if (pending !== undefined) clearTimeout(pending)
  repeats.delete(status)
  if (status.textContent !== text) {
    status.textContent = text
    return
  }
  status.textContent = ''
  repeats.set(
    status,
    setTimeout(() => {
      repeats.delete(status)
      status.textContent = text
    }, REPEAT_GAP_MS),
  )
}

const repeats = new WeakMap<Element, ReturnType<typeof setTimeout>>()

/** One step along the ladder. Leaves Overview (without going back) when it is on. */
function zoomStep(scrollport: HTMLElement, direction: 1 | -1): void {
  const view = diagramView(scrollport.dataset.scenarioId ?? '')
  const next = stepZoom(view.zoom, direction)
  if (next === view.zoom) return
  const wasOverview = view.mode.kind === 'overview'
  view.mode = zoomModeAfter(view.mode, { kind: 'step' })
  commitZoom(scrollport, next, undefined, scrollBehavior())
  announce(scrollport, { kind: wasOverview ? 'overview-off' : 'step', zoom: next })
}

/** Wheel distance (px) for one level: about one mouse-wheel notch. */
export const WHEEL_STEP_PX = 100

/** A pause this long (ms) in Ctrl/Cmd+wheel starts the count again. */
const WHEEL_IDLE_MS = 400

const LINE_PX = 16

const wheelSums = new WeakMap<HTMLElement, { sum: number; at: number }>()

/**
 * Ctrl/Cmd+wheel: the same ladder as the buttons, one level per [WHEEL_STEP_PX] of wheel. A
 * trackpad pinch sends many small deltas; adding them up keeps it from racing up the ladder, and
 * a mouse notch (about 100px) still moves one level. [deltaMode] 1 is lines, 2 pages.
 */
export function zoomByWheel(scrollport: HTMLElement, deltaY: number, deltaMode = 0, now = Date.now()): void {
  const step = wheelStep(scrollport, deltaY, deltaMode, now)
  if (step) zoomStep(scrollport, step)
}

/**
 * The level Ctrl/Cmd+wheel moves [scrollport] by, if this delta completes one: 1 (in), -1 (out)
 * or 0. Each scrollport keeps its own count. Used by both views' wheels.
 */
export function wheelStep(scrollport: HTMLElement, deltaY: number, deltaMode = 0, now = Date.now()): 1 | -1 | 0 {
  if (deltaY === 0) return 0
  const px = deltaY * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? scrollport.clientHeight || 800 : 1)
  const last = wheelSums.get(scrollport)
  const fresh = !last || now - last.at > WHEEL_IDLE_MS || Math.sign(last.sum) !== Math.sign(px)
  let sum = (fresh ? 0 : last.sum) + px
  let step: 1 | -1 | 0 = 0
  if (Math.abs(sum) >= WHEEL_STEP_PX) {
    step = sum > 0 ? -1 : 1
    sum = 0
  }
  wheelSums.set(scrollport, { sum, at: now })
  return step
}

/** Back to the default view (see fittedView), centred on [centre] (drawn px) when given. */
function resetZoom(scrollport: HTMLElement, centre?: { x: number; y: number }): void {
  // showDefaultView moves the mode on (out of Overview too).
  const zoom = showDefaultView(scrollport, centre)
  if (zoom != null) announce(scrollport, { kind: 'default', zoom })
}

/**
 * In Overview (which starts at the left edge): the lanes whose participant box is wholly inside
 * the scrollport, and all the lanes drawn (hidden ones left out). Before layout (no boxes drawn
 * yet) a lane counts when its lifeline is inside.
 */
function lanesShown(scrollport: HTMLElement): { shown: number; total: number } {
  const id = scrollport.dataset.scenarioId ?? ''
  const diagram = diagramState.mounted.get(id)
  if (!diagram) return { shown: 0, total: 0 }
  const view = diagramView(id)
  const visible = visibleParticipants(diagram.scenario.participants, view.hidden)
  const width = scrollport.clientWidth
  const header = scrollport.querySelector('.seq-header-svg')?.getBoundingClientRect()
  const boxes = [...scrollport.querySelectorAll('.seq-header-svg .participant-box')].map((box) =>
    box.getBoundingClientRect(),
  )
  if (header && boxes.some((box) => box.width > 0)) {
    const shown = boxes.filter((box) => box.left >= header.left && box.right <= header.left + width)
    return { shown: shown.length, total: visible.length }
  }
  const index = laneIndex(visible)
  const left = frameOf(diagram, view.hidden).left
  const xs = visible.map((_, i) => xFor(i, index) + left)
  const zoom = view.zoom || 1
  return { shown: lanesInView(xs, 0, width / zoom), total: visible.length }
}

function enterOverview(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId ?? ''
  const diagram = diagramState.mounted.get(id)
  const view = diagramView(id)
  if (!diagram || view.mode.kind === 'overview') return
  if (!overviewNeeded(frameOf(diagram, view.hidden).total, scrollport.clientWidth)) {
    // Shift+1 (the button is disabled then) still gets an answer.
    announce(scrollport, { kind: 'fits', zoom: view.zoom })
    return
  }
  view.mode = zoomModeAfter(view.mode, {
    kind: 'enter-overview',
    at: { zoom: view.zoom, top: scrollport.scrollTop, left: scrollport.scrollLeft },
  })
  fitOverview(scrollport)
  announce(scrollport, { kind: 'overview', zoom: view.zoom, ...lanesShown(scrollport) })
}

/** Turn Overview off and go back to the zoom and scroll position from before it. */
function leaveOverview(scrollport: HTMLElement): void {
  const view = diagramView(scrollport.dataset.scenarioId ?? '')
  if (view.mode.kind !== 'overview') return
  const saved = view.mode.saved
  // Back to the saved mode before the commit, so the readout it paints is not Overview's.
  view.mode = zoomModeAfter(view.mode, { kind: 'leave-overview' })
  commitZoom(scrollport, saved.zoom, { top: saved.top, left: saved.left }, scrollBehavior())
  // The panel may have changed width while Overview was on: refit an unzoomed diagram to it.
  refitDiagram(scrollport)
  announce(scrollport, { kind: 'overview-off', zoom: view.zoom })
}

/** From Overview, the default view centred on a message (Enter on it). */
export function zoomToMessage(scrollport: HTMLElement, messageId: string): void {
  const id = scrollport.dataset.scenarioId ?? ''
  const diagram = diagramState.mounted.get(id)
  const row = diagram?.rows.find((item) => item.event.kind === 'message' && item.event.id === messageId)
  const box = diagram && row ? messageLabelBox(diagram, diagramView(id).hidden, row) : null
  if (!box) return
  resetZoom(scrollport, { x: box.x + box.width / 2, y: row!.y })
  revealMessageX(scrollport, messageId)
}

/** From Overview, the default view centred on the point clicked or tapped. */
function zoomToPoint(scrollport: HTMLElement, ev: MouseEvent): void {
  const spacer = scrollport.querySelector<HTMLElement>('.seq-spacer')
  if (!spacer) return
  const zoom = diagramView(scrollport.dataset.scenarioId ?? '').zoom || 1
  const box = spacer.getBoundingClientRect()
  resetZoom(scrollport, { x: (ev.clientX - box.left) / zoom, y: (ev.clientY - box.top) / zoom })
}

export type ZoomAction = 'in' | 'out' | 'reset' | 'overview' | 'leave'

export function runZoomAction(scrollport: HTMLElement, action: ZoomAction): void {
  const view = diagramView(scrollport.dataset.scenarioId ?? '')
  if (action === 'in' || action === 'out') zoomStep(scrollport, action === 'in' ? 1 : -1)
  else if (action === 'reset') resetZoom(scrollport)
  else if (action === 'leave') leaveOverview(scrollport)
  else if (view.mode.kind === 'overview') leaveOverview(scrollport)
  else enterOverview(scrollport)
}

/** The four buttons, and a click or tap on the drawing while Overview is on. */
export function bindZoomControls(diagram: HTMLElement, scrollport: HTMLElement): void {
  diagram.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') return
      const action = btn.dataset.zoom
      if (action === 'in' || action === 'out' || action === 'reset' || action === 'overview') {
        runZoomAction(scrollport, action)
      }
    })
  })
  // Capture, so the click neither opens the arrow under it nor reaches the page's handlers. The
  // participant header and the More lanes cue keep their own clicks.
  scrollport.addEventListener(
    'click',
    (ev) => {
      if (diagramView(scrollport.dataset.scenarioId ?? '').mode.kind !== 'overview') return
      const target = ev.target as Element
      if (target.closest('.seq-sticky-header, .seq-more') || !target.closest('.seq-spacer')) return
      ev.preventDefault()
      ev.stopPropagation()
      // A keyboard press of a focused arrow (Space) has no point: zoom to that arrow instead.
      const message = target.closest<HTMLElement>('button.msg-open')?.dataset.messageId
      if (ev.detail === 0 && message) zoomToMessage(scrollport, message)
      else zoomToPoint(scrollport, ev)
    },
    true,
  )
  syncZoomControls(scrollport)
}
