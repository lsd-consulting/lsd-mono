// The diagram viewport: windowed painting, zoom, the default view, width observation and scroll
// binding. The zoom buttons and keys are in zoom-controls.ts.
import type { MessageEvent } from '../../types'
import { focusablePlaces, messagePlaces, replacementFocus, sidewaysScrollLeft } from '../diagram-a11y'
import {
  eventHiddenByColumns,
  fittedView,
  messageLabelRect,
  scrollportXFor,
  settleFitWidth,
  unscaledViewport,
  visibleParticipants,
} from '../diagram-view'
import type { FittedView, Rect } from '../diagram-view'
import { cssEscape } from '../escape'
import type { LayoutRow } from '../layout'
import { DEFAULT_OVERSCAN, DEFAULT_VIEWPORT, HEADER_BLOCK_H, MESSAGE_LABEL_RISE, virtualRowRange } from '../layout'
import { bindParticipantFilter } from '../participant-filter'
import { scrollBehavior } from '../media'
import { PRINT_MAX_UPSCALE, findFieldLabel, frameOf, paintedMessageIds } from '../sequence-diagram'
import { headActionKey, headerHtml, windowSvg } from './rows'
import { laneIndex, shortMessageEndpoints, xFor } from './shapes'
import { bindPageScroll, scrollDiagramToOffset, scrollsWithPage, sizeStage } from './page-scroll'
import { addPrintSlices, removePrintSlices } from './print-slices'
import { refreshPayloadFind } from './payload-find'
import {
  SEARCH_REVEAL_DELAY_MS,
  revealSearchHit,
  syncFindControls,
  stepSearchCurrent,
  updateSearchCurrent,
} from './search-reveal'
import { type DiagramView, type MountedDiagram, diagramState, diagramView } from './state'
import { bindZoomControls, fitOverview, syncZoomControls, zoomByWheel } from './zoom-controls'

/** Paint only the rows inside the scrollport (plus overscan). Row units stay unscaled; zoom is display-only. */
export function syncDiagramWindow(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = diagramState.mounted.get(id)
  if (!diagram) return
  sizeStage(scrollport)
  syncMoreCue(scrollport)
  const view = diagramView(id)
  const zoom = view.zoom
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
  const cssHeader = header?.offsetHeight || HEADER_BLOCK_H * zoom
  const cssViewport = scrollport.clientHeight || DEFAULT_VIEWPORT
  const unscaled = unscaledViewport({
    scrollTop: scrollport.scrollTop,
    viewportHeight: cssViewport,
    headerHeight: cssHeader,
    zoom,
  })
  const range = diagramState.printAllRows
    ? { start: 0, end: diagram.rows.length }
    : virtualRowRange({
        rows: diagram.rows,
        scrollTop: unscaled.scrollTop,
        viewportHeight: unscaled.viewportHeight,
        headerHeight: unscaled.headerHeight,
        overscan: DEFAULT_OVERSCAN,
      })
  const slice = diagram.rows.slice(range.start, range.end)
  const windowEl = scrollport.querySelector<HTMLElement>('.seq-window')
  if (!windowEl) return
  const offset = slice[0]?.y ?? 0
  // Print paints every row in one drawing from the top, so it can scale to the page width.
  const viewTop = slice.length && !diagramState.printAllRows ? sliceViewTop(offset) : 0
  windowEl.style.transform = `translateY(${viewTop * zoom}px)`
  const frame = frameOf(diagram, view.hidden)
  scrollport.style.setProperty('--seq-header-h', `${cssHeader}px`)
  const prior = document.activeElement
  const priorBtn = prior instanceof Element ? prior.closest('button.msg-open') : null
  const hadFocus = Boolean(priorBtn && scrollport.contains(priorBtn) && !diagramState.movingFocus)
  const priorId = priorBtn?.getAttribute('data-message-id') ?? null
  const places = messagePlaces(diagram.scenario.events, view.hidden)
  const painted = paintedMessageIds(slice, view.hidden)
  if (hadFocus && priorId) {
    const current = view.activeMessageId ?? priorId
    if (!painted.has(current)) {
      const next = replacementFocus(current, places, painted)
      if (next && painted.has(next)) view.activeMessageId = next
    }
  }
  const stops = focusablePlaces(places)
  const tabTarget =
    view.activeMessageId && stops.some((place) => place.id === view.activeMessageId)
      ? view.activeMessageId
      : (stops[0]?.id ?? null)
  // One tab stop: the active arrow when it is painted, otherwise the scrollport.
  scrollport.tabIndex = tabTarget && painted.has(tabTarget) ? -1 : 0
  windowEl.innerHTML = slice.length ? windowSvg(diagram, slice, view, frame, viewTop) : ''
  // Again now the rows are drawn at this zoom: the rows from before a zoom change still set the
  // scroll width above, so a zoom out to the whole width could leave the cue showing.
  syncMoreCue(scrollport)
  if (hadFocus) {
    const target = view.activeMessageId ?? priorId
    if (target) {
      const btn = windowEl.querySelector<HTMLButtonElement>(`button.msg-open[data-message-id="${cssEscape(target)}"]`)
      btn?.focus({ preventScroll: true })
    }
  }
}

/** SVG viewBox top. Includes the label drawn above the first painted row. */
export function sliceViewTop(firstRowY: number): number {
  return Math.max(0, firstRowY - MESSAGE_LABEL_RISE)
}

/** Resize the sticky header and body to the current zoom and visible columns. */
export function applyDiagramFrame(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = diagramState.mounted.get(id)
  if (!diagram) return
  const view = diagramView(id)
  const frame = frameOf(diagram, view.hidden)
  const width = frame.total
  const zoom = view.zoom
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
  if (header) {
    header.style.width = `${width * zoom}px`
    // Keep the header's tab stop, and its focus, across the redraw.
    const stop = header.querySelector<HTMLElement>('.participant-heads button[tabindex="0"]')
    const key = stop ? headActionKey(stop) : null
    const focused = Boolean(stop && stop === document.activeElement)
    header.innerHTML = headerHtml(diagram.scenario, frame, view.hidden, zoom, key)
    if (focused)
      header.querySelector<HTMLElement>('.participant-heads button[tabindex="0"]')?.focus({ preventScroll: true })
  }
  const spacer = scrollport.querySelector<HTMLElement>('.seq-spacer')
  if (spacer) {
    spacer.style.height = `${diagram.height * zoom}px`
    spacer.style.width = `${width * zoom}px`
  }
  const root = scrollport.closest<HTMLElement>('.seq-diagram')
  if (!root) return
  root.style.setProperty('--seq-print-max', `${Math.round(width * PRINT_MAX_UPSCALE)}px`)
  syncZoomControls(scrollport)
}

/** Bring the current Find match on screen, down the page and sideways. False when there is none. */
function revealFindHit(scrollport: HTMLElement): boolean {
  if (!revealSearchHit(scrollport)) return false
  const scenarioId = scrollport.dataset.scenarioId
  const current = scenarioId ? diagramView(scenarioId).searchCurrentId : null
  if (current) revealMessageX(scrollport, current)
  return true
}

/** Step the diagram's find to its next (1) or previous (-1) match and bring it on screen. */
export function stepFind(scrollport: HTMLElement, step: 1 | -1): void {
  const scenarioId = scrollport.dataset.scenarioId
  const row = scenarioId ? stepSearchCurrent(scenarioId, step) : null
  if (!scenarioId || !row) return
  syncFindControls(scrollport)
  syncDiagramWindow(scrollport)
  if (revealFindHit(scrollport)) syncDiagramWindow(scrollport)
  diagramState.findHooks.stepped?.(scenarioId, row.event.id)
}

/** Zoom to [next], keeping the scroll position in proportion unless [pin] gives one. */
export function commitZoom(
  scrollport: HTMLElement,
  next: number,
  pin?: { top: number; left: number },
  motion: ScrollBehavior = 'auto',
): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const view = diagramView(id)
  const prev = view.zoom || 1
  const ratio = next / prev
  view.zoom = next
  applyDiagramFrame(scrollport)
  const top = pin ? pin.top : scrollport.scrollTop * ratio
  const left = pin ? pin.left : scrollport.scrollLeft * ratio
  if (pin && scrollsWithPage(scrollport)) {
    // A pinned position (the % readout, Overview in and out, a click in Overview) moves the page
    // itself, the stage sized for the new zoom first. Left to the scrollport, a page scroll event
    // still queued (a scroll just before the click) carried the old page position back into it.
    sizeStage(scrollport)
    scrollport.scrollTo({ left, behavior: motion })
    scrollDiagramToOffset(scrollport, top)
  } else scrollport.scrollTo({ top, left, behavior: motion })
  syncDiagramWindow(scrollport)
}

function onDiagramWheel(scrollport: HTMLElement, ev: WheelEvent): void {
  if (!ev.ctrlKey && !ev.metaKey) return
  ev.preventDefault()
  zoomByWheel(scrollport, ev.deltaY)
}

/**
 * Show the default view (the one the diagram opens at): scrolled to the top message, or centred
 * on [centre] (drawn px, from the top of the body) when given. The diagram then keeps it on
 * resizes until the user zooms. Returns the zoom, or null when there is no diagram.
 */
export function showDefaultView(scrollport: HTMLElement, centre?: { x: number; y: number }): number | null {
  const id = scrollport.dataset.scenarioId
  const diagram = id ? diagramState.mounted.get(id) : undefined
  if (!id || !diagram) return null
  const view = diagramView(id)
  const prev = view.zoom
  const fitted = settleFit(scrollport, diagram, view)
  view.zoom = prev
  view.autoFit = true
  view.fittedWidth = 0
  const scale = fitted.scale
  const header = HEADER_BLOCK_H * scale
  const pin = centre
    ? {
        top: Math.max(0, centre.y * scale - Math.max(0, scrollport.clientHeight - header) / 2),
        left: Math.max(0, centre.x * scale - scrollport.clientWidth / 2),
      }
    : { top: Math.max(0, fitted.originY) * scale, left: Math.max(0, fitted.originX) * scale }
  commitZoom(scrollport, scale, pin, scrollBehavior())
  view.fittedWidth = scrollport.clientWidth
  return scale
}

/**
 * Fit the diagram to its scrollport width, for the default view. Zooming can add or drop the
 * vertical scrollbar, which changes the width there is to fit, so this settles on a width that
 * still fits once zoomed. Leaves view.zoom at the fitted scale and the frame applied.
 */
function settleFit(scrollport: HTMLElement, diagram: MountedDiagram, view: DiagramView): FittedView {
  const contentWidth = frameOf(diagram, view.hidden).total
  const mustInclude = topMessageLabelRect(diagram, view.hidden)
  const fitAt = (viewportWidth: number) =>
    fittedView({
      contentWidth,
      viewportWidth,
      viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
      mustInclude,
    })
  const width = settleFitWidth(scrollport.clientWidth, (w) => {
    view.zoom = fitAt(w).scale
    applyDiagramFrame(scrollport)
    return scrollport.clientWidth
  })
  return fitAt(width)
}

function printing(): boolean {
  return diagramState.printAllRows || (typeof matchMedia === 'function' && matchMedia('print').matches)
}

/**
 * Fit a diagram the user has not zoomed (see [DiagramView.autoFit]) to the default view, or
 * refit Overview while it is on. Does nothing while its card is collapsed (no width yet), while
 * printing, or when the width is the one it last fitted. `first` scrolls to the top message like
 * the % readout; a refit keeps the scroll position in proportion.
 */
function autoFitDiagram(scrollport: HTMLElement, first: boolean): void {
  const id = scrollport.dataset.scenarioId
  const diagram = id ? diagramState.mounted.get(id) : undefined
  if (!id || !diagram) return
  const view = diagramView(id)
  if ((!view.autoFit && !view.overview) || printing()) return
  const width = scrollport.clientWidth
  if (width <= 0 || Math.abs(width - view.fittedWidth) <= 1) return
  if (view.overview) {
    fitOverview(scrollport)
    return
  }
  const prev = view.zoom || 1
  const top = scrollport.scrollTop
  const left = scrollport.scrollLeft
  const fitted = settleFit(scrollport, diagram, view)
  view.zoom = fitted.scale
  applyDiagramFrame(scrollport)
  if (first) {
    scrollport.scrollTo({
      top: Math.max(0, fitted.originY) * fitted.scale,
      left: Math.max(0, fitted.originX) * fitted.scale,
    })
  } else {
    const ratio = fitted.scale / prev
    scrollport.scrollTo({ top: top * ratio, left: left * ratio })
  }
  view.fittedWidth = scrollport.clientWidth
  syncDiagramWindow(scrollport)
}

function observeWidth(scrollport: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return
  diagramState.widthObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      const scrollport = entry.target as HTMLElement
      autoFitDiagram(scrollport, false)
      // Whether Overview has anything to show depends on the width.
      syncZoomControls(scrollport)
    }
  })
  for (const old of diagramState.observedScrollports) {
    if (!old.isConnected) {
      diagramState.widthObserver.unobserve(old)
      diagramState.observedScrollports.delete(old)
    }
  }
  diagramState.widthObserver.observe(scrollport)
  diagramState.observedScrollports.add(scrollport)
}

/** Label box of a message row, in drawn coordinates (they start frame.left left of x = 0). */
export function messageLabelBox(diagram: MountedDiagram, hiddenIds: ReadonlySet<string>, row: LayoutRow): Rect | null {
  const event = row.event
  if (event.kind !== 'message' || eventHiddenByColumns(event, hiddenIds)) return null
  const frame = frameOf(diagram, hiddenIds)
  const index = laneIndex(visibleParticipants(diagram.scenario.participants, hiddenIds))
  const ends = messageEndpoints(event, index, frame.base)
  const rect = messageLabelRect({ arrowY: row.y, x1: ends.x1, x2: ends.x2 })
  return { ...rect, x: rect.x + frame.left }
}

/** Label box of the uppermost message still drawn. The default view scrolls this into view. */
function topMessageLabelRect(diagram: MountedDiagram, hiddenIds: ReadonlySet<string>): Rect {
  for (const row of diagram.rows) {
    const box = messageLabelBox(diagram, hiddenIds, row)
    if (box) return box
  }
  return { x: 0, y: 0, width: 1, height: 1 }
}

/**
 * Scroll sideways, only as far as needed, so a message's label is inside the scrollport. The
 * default view can stop at a readable scale with lanes beyond the right edge; Find and keyboard
 * focus use this to bring a match or an arrow out of them.
 */
export function revealMessageX(scrollport: HTMLElement, messageId: string): void {
  const id = scrollport.dataset.scenarioId
  const diagram = id ? diagramState.mounted.get(id) : undefined
  if (!id || !diagram) return
  const row = diagram.rows.find((item) => item.event.kind === 'message' && item.event.id === messageId)
  const box = row && messageLabelBox(diagram, diagramView(id).hidden, row)
  if (!box) return
  const zoom = diagramView(id).zoom
  const left = box.x * zoom
  const right = left + box.width * zoom
  const view = scrollport.clientWidth
  const next = scrollportXFor(scrollport.scrollLeft, view, left, right)
  if (next !== scrollport.scrollLeft) scrollport.scrollLeft = next
}

/**
 * Mark a scrollport that has lanes beyond its right edge, for the "more lanes" cue. When the cue
 * hides under focus (pressed until the right edge), focus moves to the scrollport, not <body>.
 * Safari doesn't focus a clicked button, so there the handoff never runs (and isn't needed).
 */
export function syncMoreCue(scrollport: HTMLElement): void {
  const more = scrollport.scrollWidth - scrollport.clientWidth - scrollport.scrollLeft > 4
  const active = scrollport.ownerDocument.activeElement
  if (!more && active?.matches('[data-more-lanes]') && scrollport.contains(active)) {
    scrollport.focus({ preventScroll: true })
  }
  scrollport.toggleAttribute('data-more-right', more)
}

export function messageEndpoints(
  msg: MessageEvent,
  index: Map<string, number>,
  width: number,
): { x1: number; x2: number } {
  if (msg.type === 'SHORT_INBOUND' || msg.type === 'SHORT_OUTBOUND') {
    const participantId = msg.type === 'SHORT_INBOUND' ? msg.to : msg.from
    const px = xFor(index.get(participantId) ?? 0, index)
    return shortMessageEndpoints(msg.type, px, width)
  }
  const fi = index.get(msg.from) ?? 0
  const ti = index.get(msg.to) ?? 0
  return { x1: xFor(fi, index), x2: xFor(ti, index) }
}

/** Replace a diagram's hidden participants, then redraw, refit and repaint. */
function setHiddenParticipants(scrollport: HTMLElement, next: ReadonlySet<string>): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const view = diagramView(id)
  view.hidden.clear()
  for (const participantId of next) view.hidden.add(participantId)
  const places = messagePlaces(diagramState.mounted.get(id)?.scenario.events ?? [], view.hidden)
  if (view.activeMessageId && !focusablePlaces(places).some((place) => place.id === view.activeMessageId)) {
    view.activeMessageId = null
  }
  applyDiagramFrame(scrollport)
  syncFindControls(scrollport)
  if (view.overview) {
    // Overview stays on, fitted to the lanes that are left.
    fitOverview(scrollport)
  } else if (view.autoFit) {
    // Hiding or showing a participant changes the width to fit.
    view.fittedWidth = 0
    autoFitDiagram(scrollport, false)
  }
  syncDiagramWindow(scrollport)
}

function ensurePrintHooks(): void {
  if (diagramState.printHooks || typeof window === 'undefined') return
  diagramState.printHooks = true
  const repaint = () => {
    document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => syncDiagramWindow(el))
  }
  const diagrams = () => document.querySelectorAll<HTMLElement>('.seq-diagram')
  window.addEventListener('beforeprint', () => {
    diagramState.printAllRows = true
    repaint()
    diagrams().forEach((diagram) => addPrintSlices(diagram))
  })
  window.addEventListener('afterprint', () => {
    diagrams().forEach((diagram) => removePrintSlices(diagram))
    diagramState.printAllRows = false
    repaint()
  })
}

/** The scenario's mounted scrollport, looked up when an answer arrives (the diagram may have re-rendered). */
function scrollportOf(scenarioId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.seq-scroll[data-scenario-id="${cssEscape(scenarioId)}"]`)
}

/** What the "More lanes →" button does: what Shift+→ does from the keyboard. */
const SCREEN_RIGHT = { key: 'ArrowRight', shiftKey: true, metaKey: false, ctrlKey: false, altKey: false }

/**
 * Search the scenario's payloads for its query. An answer that arrives after the keystroke
 * repaints the matches and the count, and unless the user has stepped since typing, the first
 * match becomes current and comes on screen.
 */
function refreshPayloads(scenarioId: string): void {
  const scenario = diagramState.mounted.get(scenarioId)?.scenario
  if (!scenario) return
  refreshPayloadFind(scenario, () => {
    const scroll = scrollportOf(scenarioId)
    if (!scroll) return
    const view = diagramView(scenarioId)
    const before = view.searchCurrentId ?? null
    // Until Next or Previous moves it, the current match is the first: maybe a payload match above.
    if (!before || !view.searchStepped) updateSearchCurrent(scenarioId)
    syncFindControls(scroll)
    syncDiagramWindow(scroll)
    if (view.searchCurrentId !== before && revealFindHit(scroll)) syncDiagramWindow(scroll)
    diagramState.findHooks.changed?.(scenarioId)
  })
}

export function bindDiagramScroll(root: ParentNode): void {
  ensurePrintHooks()
  root.querySelectorAll<HTMLElement>('.seq-diagram').forEach((diagram) => {
    const scroll = diagram.querySelector<HTMLElement>('.seq-scroll')
    if (!scroll?.dataset.scenarioId) return
    const id = scroll.dataset.scenarioId
    applyDiagramFrame(scroll)
    // Fit before anything scrolls to a message (deep link, Timing view row), so that scroll uses
    // the fitted zoom. A re-render keeps the fit it already has.
    const view = diagramView(id)
    if (view.autoFit) view.fittedWidth = 0
    autoFitDiagram(scroll, true)
    syncDiagramWindow(scroll)
    observeWidth(scroll)
    scroll.addEventListener('scroll', () => syncDiagramWindow(scroll), { passive: true })
    bindPageScroll(scroll)
    scroll.addEventListener('wheel', (ev) => onDiagramWheel(scroll, ev), { passive: false })
    bindZoomControls(diagram, scroll)
    // The "More lanes →" cue is a button: it scrolls one screen right, and a click on it never
    // reaches the arrow underneath (#65).
    diagram.querySelector<HTMLButtonElement>('[data-more-lanes]')?.addEventListener('click', (ev) => {
      ev.stopPropagation()
      const left = sidewaysScrollLeft(SCREEN_RIGHT, scroll)
      if (left != null) scroll.scrollLeft = left
    })
    bindParticipantFilter(diagram, {
      participants: () => diagramState.mounted.get(id)?.scenario.participants ?? [],
      hidden: () => diagramView(id).hidden,
      setHidden: (next) => setHiddenParticipants(scroll, next),
    })
    const find = diagram.querySelector<HTMLInputElement>('[data-diagram-find]')
    let reveal: ReturnType<typeof setTimeout> | undefined
    // Payloads load the first time Find is used, so they are often ready before the first key.
    find?.addEventListener('focus', () => refreshPayloads(id))
    if (view.query) refreshPayloads(id)
    find?.addEventListener('input', () => {
      diagramView(id).query = find.value
      refreshPayloads(id)
      updateSearchCurrent(id)
      syncFindControls(scroll)
      syncDiagramWindow(scroll)
      diagramState.findHooks.changed?.(id)
      // Typing on a phone has no Enter: bring the first match on screen once typing pauses.
      clearTimeout(reveal)
      reveal = setTimeout(() => {
        if (revealFindHit(scroll)) syncDiagramWindow(scroll)
      }, SEARCH_REVEAL_DELAY_MS)
    })
    diagram.querySelector<HTMLButtonElement>('[data-find-payloads]')?.addEventListener('click', (ev) => {
      const view = diagramView(id)
      view.includePayloads = !view.includePayloads
      const toggle = ev.currentTarget as HTMLButtonElement
      toggle.setAttribute('aria-pressed', String(view.includePayloads))
      find?.setAttribute('aria-label', findFieldLabel(view.includePayloads))
      refreshPayloads(id)
      updateSearchCurrent(id)
      syncFindControls(scroll)
      syncDiagramWindow(scroll)
      diagramState.findHooks.changed?.(id)
    })
    diagram.querySelectorAll<HTMLButtonElement>('[data-find-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        clearTimeout(reveal)
        stepFind(scroll, btn.dataset.findStep === 'prev' ? -1 : 1)
      })
    })
  })
}
