// Zoom controls (#94): [−] [N%] [+] [Overview], their keys, and the one status message each
// change makes. − and + step through ZOOM_LEVELS, the % readout goes back to the default view,
// and Overview fits the whole drawing's width (down to OVERVIEW_MIN_ZOOM) until it is turned off.
import {
  canStepZoom,
  lanesInView,
  overviewNeeded,
  overviewScale,
  settleFitWidth,
  stepZoom,
  visibleParticipants,
  zoomAnnouncement,
  zoomLabel,
  type ZoomChange,
} from '../diagram-view'
import { escapeAttr, escapeHtml } from '../escape'
import { scrollBehavior } from '../media'
import { frameOf, messageLabelBox } from './geometry'
import { singleKeysEnabled } from '../../ui/shortcuts'
import { laneIndex, xFor } from './shapes'
import { type DiagramView, diagramState, diagramView } from './state'
import { applyDiagramFrame, commitZoom, refitDiagram, revealMessageX, showDefaultView } from './viewport'

const ICON =
  'class="zoom-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"'
const minusSvg = `<svg ${ICON} stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>`
const plusSvg = `<svg ${ICON} stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`
/**
 * Lucide "scan" (https://lucide.dev/icons/scan): ISC License, Copyright (c) 2026 Lucide Icons and
 * Contributors. The full notice is in THIRD-PARTY-NOTICES.md at the repository root. (No comment
 * in the markup: the single-file report cannot hold "<!--" in its inline script.)
 */
const scanSvg = `<svg ${ICON} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>`

const OVERVIEW_TITLE = 'Overview: whole diagram (Shift+1)'
const OVERVIEW_FITS_TITLE = 'Whole diagram already fits'

function readoutName(zoom: number): string {
  return `Reset zoom, now ${zoomLabel(zoom)}`
}

function disabledAttr(disabled: boolean): string {
  return disabled ? ' aria-disabled="true"' : ''
}

/** The Zoom group in the diagram toolbar. syncZoomControls keeps it up to date. */
export function zoomControlsHtml(view: DiagramView): string {
  const overview = view.overview != null
  return `<div class="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" class="zoom-btn" data-zoom="out" aria-label="Zoom out" title="Zoom out (−)"${disabledAttr(!canStepZoom(view.zoom, -1))}>${minusSvg}</button>
        <button type="button" class="zoom-readout" data-zoom="reset" aria-label="${escapeAttr(readoutName(view.zoom))}" title="Reset to default zoom (0)">${escapeHtml(zoomLabel(view.zoom))}</button>
        <button type="button" class="zoom-btn" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)"${disabledAttr(!canStepZoom(view.zoom, 1))}>${plusSvg}</button>
        <button type="button" class="zoom-btn zoom-overview" data-zoom="overview" aria-label="Overview" aria-pressed="${overview}" title="${escapeAttr(OVERVIEW_TITLE)}">${scanSvg}<span class="zoom-overview-label" aria-hidden="true">Overview</span></button>
      </div>`
}

function setDisabled(btn: Element | null, disabled: boolean): void {
  if (!btn) return
  if (disabled) btn.setAttribute('aria-disabled', 'true')
  else btn.removeAttribute('aria-disabled')
}

/** The readout, the limits of − and +, and whether Overview is on or has anything to show. */
export function syncZoomControls(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  const diagram = id ? diagramState.mounted.get(id) : undefined
  const group = scrollport.closest('.seq-diagram')?.querySelector('.zoom-controls')
  if (!id || !diagram || !group) return
  const view = diagramView(id)
  const readout = group.querySelector('[data-zoom="reset"]')
  if (readout) {
    readout.textContent = zoomLabel(view.zoom)
    readout.setAttribute('aria-label', readoutName(view.zoom))
  }
  setDisabled(group.querySelector('[data-zoom="out"]'), !canStepZoom(view.zoom, -1))
  setDisabled(group.querySelector('[data-zoom="in"]'), !canStepZoom(view.zoom, 1))
  const overview = group.querySelector('[data-zoom="overview"]')
  if (!overview) return
  const on = view.overview != null
  // Unmeasured (a collapsed card) counts as fitting: there is nothing to show yet.
  const useful = on || overviewNeeded(frameOf(diagram, view.hidden).total, scrollport.clientWidth)
  overview.setAttribute('aria-pressed', String(on))
  setDisabled(overview, !useful)
  overview.setAttribute('title', useful ? OVERVIEW_TITLE : OVERVIEW_FITS_TITLE)
}

/** Say what changed, once, in the toolbar's status line (the one the participant filter uses). */
/** How long the status line stays empty before it says again what it last said. */
const REPEAT_GAP_MS = 100

/**
 * Say [change] in the diagram's polite status line. The same words again (the % readout pressed
 * twice) would be no change to a screen reader, so the line empties first and speaks a moment later.
 */
function announce(scrollport: HTMLElement, change: ZoomChange): void {
  const status = scrollport.closest('.seq-diagram')?.querySelector('.participant-filter-status')
  if (!status) return
  const text = zoomAnnouncement(change)
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
  const wasOverview = view.overview !== null
  view.overview = null
  view.autoFit = false
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
  if (deltaY === 0) return
  const px = deltaY * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? scrollport.clientHeight || 800 : 1)
  const last = wheelSums.get(scrollport)
  const fresh = !last || now - last.at > WHEEL_IDLE_MS || Math.sign(last.sum) !== Math.sign(px)
  let sum = (fresh ? 0 : last.sum) + px
  if (Math.abs(sum) >= WHEEL_STEP_PX) {
    zoomStep(scrollport, sum > 0 ? -1 : 1)
    sum = 0
  }
  wheelSums.set(scrollport, { sum, at: now })
}

/** Back to the default view (see fittedView), centred on [centre] (drawn px) when given. */
function resetZoom(scrollport: HTMLElement, centre?: { x: number; y: number }): void {
  const view = diagramView(scrollport.dataset.scenarioId ?? '')
  view.overview = null
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

/**
 * Fit the whole width at Overview's scale. Showing or dropping the vertical scrollbar changes the
 * width there is, so this settles it like the default view does. Keeps the rows at the top of the
 * view where they were, and starts at the left edge.
 */
export function fitOverview(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId ?? ''
  const diagram = diagramState.mounted.get(id)
  if (!diagram) return
  const view = diagramView(id)
  const prev = view.zoom || 1
  const top = scrollport.scrollTop
  const contentWidth = frameOf(diagram, view.hidden).total
  const width = settleFitWidth(scrollport.clientWidth, (w) => {
    view.zoom = overviewScale(contentWidth, w)
    applyDiagramFrame(scrollport)
    return scrollport.clientWidth
  })
  const scale = overviewScale(contentWidth, width)
  view.zoom = prev
  commitZoom(scrollport, scale, { top: (top * scale) / prev, left: 0 }, scrollBehavior())
  view.fittedWidth = scrollport.clientWidth
}

function enterOverview(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId ?? ''
  const diagram = diagramState.mounted.get(id)
  const view = diagramView(id)
  if (!diagram || view.overview) return
  if (!overviewNeeded(frameOf(diagram, view.hidden).total, scrollport.clientWidth)) {
    // Shift+1 (the button is disabled then) still gets an answer.
    announce(scrollport, { kind: 'fits', zoom: view.zoom })
    return
  }
  view.overview = {
    zoom: view.zoom,
    top: scrollport.scrollTop,
    left: scrollport.scrollLeft,
    autoFit: view.autoFit,
    fittedWidth: view.fittedWidth,
  }
  view.autoFit = false
  fitOverview(scrollport)
  announce(scrollport, { kind: 'overview', zoom: view.zoom, ...lanesShown(scrollport) })
}

/** Turn Overview off and go back to the zoom and scroll position from before it. */
function leaveOverview(scrollport: HTMLElement): void {
  const view = diagramView(scrollport.dataset.scenarioId ?? '')
  const saved = view.overview
  if (!saved) return
  view.overview = null
  commitZoom(scrollport, saved.zoom, { top: saved.top, left: saved.left }, scrollBehavior())
  view.autoFit = saved.autoFit
  view.fittedWidth = saved.fittedWidth
  // The panel may have changed width while Overview was on: refit an unzoomed diagram to it.
  refitDiagram(scrollport)
  announce(scrollport, { kind: 'overview-off', zoom: view.zoom })
}

/** From Overview, the default view centred on a message (Enter on it). */
function zoomToMessage(scrollport: HTMLElement, messageId: string): void {
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

type ZoomKeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>

/**
 * The zoom action a key asks for, or null. + or =, -, 0 and Shift+1 (by key position, so it works
 * where Shift+1 is not "!") are single-key shortcuts and follow the toggle (#82, WCAG 2.1.4). Esc
 * leaves Overview. Ctrl/Cmd with any of them stays the browser's zoom (WCAG 1.4.4).
 */
export function zoomKeyAction(e: ZoomKeyEvent, ctx: { singleKeys: boolean; overview: boolean }): ZoomAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  if (e.key === 'Escape') return ctx.overview ? 'leave' : null
  if (!ctx.singleKeys) return null
  if (e.key === '+' || e.key === '=') return 'in'
  if (e.key === '-' || e.key === '−') return 'out'
  // Shift is allowed: on AZERTY the digit row needs it for 0.
  if (e.key === '0') return 'reset'
  if (e.shiftKey && e.code === 'Digit1') return 'overview'
  return null
}

function runZoomAction(scrollport: HTMLElement, action: ZoomAction): void {
  const view = diagramView(scrollport.dataset.scenarioId ?? '')
  if (action === 'in' || action === 'out') zoomStep(scrollport, action === 'in' ? 1 : -1)
  else if (action === 'reset') resetZoom(scrollport)
  else if (action === 'leave') leaveOverview(scrollport)
  else if (view.overview) leaveOverview(scrollport)
  else enterOverview(scrollport)
}

function isTextField(el: HTMLElement): boolean {
  return el.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

/**
 * Zoom keys, while focus is in a diagram card (toolbar, participant header, scrollport or a
 * message) and not in a text field or a menu. True when the key was used. In Overview, Enter on
 * a message zooms to it instead of opening it.
 */
export function onZoomKey(ev: KeyboardEvent): boolean {
  const target = ev.target as HTMLElement | null
  if (!target?.closest || isTextField(target) || target.closest('[role="menu"]')) return false
  const scrollport = target.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-scroll')
  const id = scrollport?.dataset.scenarioId
  if (!scrollport || !id || !diagramState.mounted.has(id)) return false
  const view = diagramView(id)
  const message = target.closest<HTMLElement>('button.msg-open')
  const plain = !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey
  if (view.overview && message?.dataset.messageId && ev.key === 'Enter' && plain) {
    ev.preventDefault()
    ev.stopPropagation()
    zoomToMessage(scrollport, message.dataset.messageId)
    return true
  }
  const action = zoomKeyAction(ev, { singleKeys: singleKeysEnabled(), overview: view.overview != null })
  if (!action) return false
  ev.preventDefault()
  ev.stopPropagation()
  runZoomAction(scrollport, action)
  return true
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
      if (!diagramView(scrollport.dataset.scenarioId ?? '').overview) return
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
