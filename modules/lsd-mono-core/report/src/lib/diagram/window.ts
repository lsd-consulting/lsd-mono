// The diagram's frame and window: the header and body sized to the zoom and the hidden lanes,
// the rows painted around the scroll position, the More lanes cue, and scrolling a message into view.
import { focusablePlaces, messagePlaces, replacementFocus } from '../diagram-a11y'
import { scrollportXFor, unscaledViewport } from '../diagram-view'
import { cssEscape } from '../escape'
import { DEFAULT_OVERSCAN, DEFAULT_VIEWPORT, HEADER_BLOCK_H, virtualRowRange } from '../layout'
import { PRINT_MAX_UPSCALE, frameOf, messageLabelBox, paintedMessageIds, sliceViewTop } from './geometry'
import { headActionKey, headerHtml, resizeHeader, windowSvg } from './rows'
import { sizeStage } from './page-scroll'
import { diagramState, diagramView } from './state'
import { syncZoomControls } from './zoom-readout'

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
  // Once the rows are drawn at this zoom: before the paint, the rows from before a zoom change
  // still set the scroll width, so a zoom out to the whole width could leave the cue showing.
  syncMoreCue(scrollport)
  if (hadFocus) {
    const target = view.activeMessageId ?? priorId
    if (target) {
      const btn = windowEl.querySelector<HTMLButtonElement>(`button.msg-open[data-message-id="${cssEscape(target)}"]`)
      btn?.focus({ preventScroll: true })
    }
  }
}

/** Scrollports resized for a trial scale and not drawn since. */
const unredrawn = new WeakSet<HTMLElement>()

/**
 * Run [trials], which may size the frame for trial scales with the resize it is handed, and end
 * with the frame drawn: when a trial resize is the last thing done to it, applyDiagramFrame runs
 * before this returns (an exception too). Calls nest and share that one drawing, so a fit inside
 * a lane change draws once. The only way to resize without drawing.
 */
export function withTrialFrames<T>(scrollport: HTMLElement, trials: (resize: () => void) => T): T {
  try {
    return trials(() => resizeDiagram(scrollport))
  } finally {
    if (unredrawn.has(scrollport)) applyDiagramFrame(scrollport)
  }
}

/**
 * Size the header and body for the current zoom and visible lanes: enough to measure the width a
 * fit has left (settleFit, fitOverview try a scale, look at the scrollbar, and try again). The
 * header is resized in place (resizeHeader). After lanes are hidden or shown its heads are the old
 * lanes' until it is drawn again, so they are clipped, not to widen the scroll; withTrialFrames
 * draws it, once the scale is settled and before anything paints.
 */
function resizeDiagram(scrollport: HTMLElement): void {
  sizeDiagramFrame(scrollport)
}

/**
 * Size the frame without drawing it, for code that scrolls to the new extent at once and has
 * the drawing done once with the rows (invalidate's 'frame'). Until then the header keeps its
 * old lanes, clipped.
 */
export function sizeDiagramFrame(scrollport: HTMLElement): void {
  unredrawn.add(scrollport)
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
    // Lanes hidden or shown: the heads are the old lanes' until the header is drawn again, so they
    // are clipped, not to widen the scroll.
    if (!resizeHeader(header, diagram.scenario, frame, view.hidden, zoom)) {
      const svg = header.querySelector('.seq-header-svg')
      svg?.setAttribute('viewBox', `${-frame.left} 0 ${width} ${HEADER_BLOCK_H}`)
      svg?.setAttribute('width', String(width * zoom))
      svg?.setAttribute('height', String(HEADER_BLOCK_H * zoom))
      header.querySelector<HTMLElement>('.participant-heads')?.style.setProperty('overflow', 'hidden')
    }
  }
  const spacer = scrollport.querySelector<HTMLElement>('.seq-spacer')
  if (spacer) {
    spacer.style.height = `${diagram.height * zoom}px`
    spacer.style.width = `${width * zoom}px`
  }
}

/**
 * Draw the sticky header and size the body for the current zoom and visible lanes, then bring
 * the zoom readout up to date. Once per change (#100): a zoom step, reset, Overview on or off, a
 * refit, a lane hidden or shown.
 */
export function applyDiagramFrame(scrollport: HTMLElement): void {
  unredrawn.delete(scrollport)
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
    // A zoom resizes the header in place, so focus and the buttons stay put. Lanes hidden or shown
    // draw it afresh, the row's tab stop kept on the button that had it; the filter moves focus
    // after the change itself (bindParticipantFilter's focusAfter).
    if (!resizeHeader(header, diagram.scenario, frame, view.hidden, zoom)) {
      const stop = header.querySelector<HTMLElement>('.participant-heads button[tabindex="0"]')
      header.innerHTML = headerHtml(diagram.scenario, frame, view.hidden, zoom, stop ? headActionKey(stop) : null)
    }
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
