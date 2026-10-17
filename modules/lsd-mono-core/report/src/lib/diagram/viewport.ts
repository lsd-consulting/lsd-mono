// The diagram viewport: windowed painting, zoom, fit, width observation and scroll binding.
import type { MessageEvent } from '../../types'
import { focusablePlaces, messagePlaces, replacementFocus } from '../diagram-a11y'
import {
  MAX_ZOOM,
  eventHiddenByColumns,
  fittedView,
  messageLabelRect,
  settleFitWidth,
  stepZoom,
  unscaledViewport,
  visibleParticipants,
  zoomFromWheel,
  zoomLabel,
} from '../diagram-view'
import type { FittedView, Rect } from '../diagram-view'
import { cssEscape } from '../escape'
import { DEFAULT_OVERSCAN, DEFAULT_VIEWPORT, HEADER_BLOCK_H, MESSAGE_LABEL_RISE, virtualRowRange } from '../layout'
import { bindParticipantFilter } from '../participant-filter'
import { scrollBehavior } from '../media'
import { PRINT_MAX_UPSCALE, frameOf, paintedMessageIds } from '../sequence-diagram'
import { headActionKey, headerHtml, windowSvg } from './rows'
import { laneIndex, shortMessageEndpoints, xFor } from './shapes'
import { bindPageScroll, sizeStage } from './page-scroll'
import {
  SEARCH_REVEAL_DELAY_MS,
  revealSearchHit,
  syncFindControls,
  stepSearchCurrent,
  updateSearchCurrent,
} from './search-reveal'
import { type DiagramView, type MountedDiagram, diagramState, diagramView } from './state'

/** Paint only the rows inside the scrollport (plus overscan). Row units stay unscaled; zoom is display-only. */
export function syncDiagramWindow(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = diagramState.mounted.get(id)
  if (!diagram) return
  sizeStage(scrollport)
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
function applyDiagramFrame(scrollport: HTMLElement): void {
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
  const readout = root.querySelector('.zoom-readout')
  if (readout) readout.textContent = zoomLabel(zoom)
}

/** Step the diagram's find to its next (1) or previous (-1) match and bring it on screen. */
export function stepFind(scrollport: HTMLElement, step: 1 | -1): void {
  const scenarioId = scrollport.dataset.scenarioId
  if (!scenarioId || !stepSearchCurrent(scenarioId, step)) return
  syncFindControls(scrollport)
  syncDiagramWindow(scrollport)
  if (revealSearchHit(scrollport)) syncDiagramWindow(scrollport)
}

function commitZoom(
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
  scrollport.scrollTo({ top, left, behavior: motion })
  syncDiagramWindow(scrollport)
}

function onDiagramWheel(scrollport: HTMLElement, ev: WheelEvent): void {
  if (!ev.ctrlKey && !ev.metaKey) return
  ev.preventDefault()
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const view = diagramView(id)
  const next = zoomFromWheel(view.zoom, ev.deltaY)
  if (next === view.zoom) return
  view.autoFit = false
  commitZoom(scrollport, next)
}

function onZoomClick(scrollport: HTMLElement, action: string | undefined): void {
  const id = scrollport.dataset.scenarioId
  if (!id || !action) return
  const diagram = diagramState.mounted.get(id)
  if (!diagram) return
  const view = diagramView(id)
  if (action === 'fit') {
    const prev = view.zoom
    const fitted = settleFit(scrollport, diagram, view)
    view.zoom = prev
    view.autoFit = true
    view.fitLimit = MAX_ZOOM
    view.fittedWidth = 0
    commitZoom(
      scrollport,
      fitted.scale,
      {
        top: Math.max(0, fitted.originY) * fitted.scale,
        left: Math.max(0, fitted.originX) * fitted.scale,
      },
      scrollBehavior(),
    )
    view.fittedWidth = scrollport.clientWidth
    return
  }
  if (action !== 'in' && action !== 'out') return
  const next = stepZoom(view.zoom, action === 'in' ? 1 : -1)
  view.autoFit = false
  commitZoom(scrollport, next, undefined, scrollBehavior())
}

/**
 * Fit the diagram to its scrollport width. Zooming can add or drop the vertical
 * scrollbar, which changes the width there is to fit, so this settles on a width that
 * still fits once zoomed. Leaves view.zoom at the fitted scale and the frame applied.
 */
function settleFit(scrollport: HTMLElement, diagram: MountedDiagram, view: DiagramView, maxScale?: number): FittedView {
  const contentWidth = frameOf(diagram, view.hidden).total
  const mustInclude = topMessageLabelRect(diagram, view.hidden)
  const fitAt = (viewportWidth: number) =>
    fittedView({
      contentWidth,
      viewportWidth,
      viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
      mustInclude,
      maxScale,
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
 * Fit a diagram the user has not zoomed (see [DiagramView.autoFit]). Does nothing while
 * its card is collapsed (no width yet), while printing, or when the width is the one it
 * last fitted. `first` scrolls to the top message like Fit; a refit keeps the scroll
 * position in proportion.
 */
function autoFitDiagram(scrollport: HTMLElement, first: boolean): void {
  const id = scrollport.dataset.scenarioId
  const diagram = id ? diagramState.mounted.get(id) : undefined
  if (!id || !diagram) return
  const view = diagramView(id)
  if (!view.autoFit || printing()) return
  const width = scrollport.clientWidth
  if (width <= 0 || Math.abs(width - view.fittedWidth) <= 1) return
  const prev = view.zoom || 1
  const top = scrollport.scrollTop
  const left = scrollport.scrollLeft
  const fitted = settleFit(scrollport, diagram, view, view.fitLimit)
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
    for (const entry of entries) autoFitDiagram(entry.target as HTMLElement, false)
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

/** Label box of the uppermost message still drawn. Fit scrolls this into view. */
function topMessageLabelRect(diagram: MountedDiagram, hiddenIds: ReadonlySet<string>): Rect {
  const frame = frameOf(diagram, hiddenIds)
  const width = frame.base
  const visible = visibleParticipants(diagram.scenario.participants, hiddenIds)
  const index = laneIndex(visible)
  for (const row of diagram.rows) {
    const event = row.event
    if (event.kind !== 'message' || eventHiddenByColumns(event, hiddenIds)) continue
    const ends = messageEndpoints(event, index, width)
    const rect = messageLabelRect({ arrowY: row.y, x1: ends.x1, x2: ends.x2 })
    // Fit works in drawn coordinates, which start frame.left left of x = 0.
    return { ...rect, x: rect.x + frame.left }
  }
  return { x: 0, y: 0, width: 1, height: 1 }
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
  if (view.autoFit) {
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
  window.addEventListener('beforeprint', () => {
    diagramState.printAllRows = true
    repaint()
  })
  window.addEventListener('afterprint', () => {
    diagramState.printAllRows = false
    repaint()
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
    diagram.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((btn) => {
      btn.addEventListener('click', () => onZoomClick(scroll, btn.dataset.zoom))
    })
    bindParticipantFilter(diagram, {
      participants: () => diagramState.mounted.get(id)?.scenario.participants ?? [],
      hidden: () => diagramView(id).hidden,
      setHidden: (next) => setHiddenParticipants(scroll, next),
    })
    const find = diagram.querySelector<HTMLInputElement>('[data-diagram-find]')
    let reveal: ReturnType<typeof setTimeout> | undefined
    find?.addEventListener('input', () => {
      diagramView(id).query = find.value
      updateSearchCurrent(id)
      syncFindControls(scroll)
      syncDiagramWindow(scroll)
      // Typing on a phone has no Enter: bring the first match on screen once typing pauses.
      clearTimeout(reveal)
      reveal = setTimeout(() => {
        if (revealSearchHit(scroll)) syncDiagramWindow(scroll)
      }, SEARCH_REVEAL_DELAY_MS)
    })
    diagram.querySelectorAll<HTMLButtonElement>('[data-find-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        clearTimeout(reveal)
        stepFind(scroll, btn.dataset.findStep === 'prev' ? -1 : 1)
      })
    })
  })
}
