// Binding a mounted diagram: its frame and fit, scrolling, the width observer, Ctrl/Cmd+wheel,
// the zoom controls, the participant filter and Find. Each part lives in its own module.
import { focusablePlaces, messagePlaces, sidewaysScrollLeft } from '../diagram-a11y'
import { bindParticipantFilter } from '../participant-filter'
import { bindPageScroll } from './page-scroll'
import { syncFindControls } from './search-reveal'
import { diagramState, diagramView } from './state'
import { zoomModeAfter } from './zoom-mode'
import { bindFind } from './find-binding'
import { ensurePrintHooks } from './print-hooks'
import { applyDiagramFrame, syncDiagramWindow } from './window'
import { bindZoomControls, zoomByWheel } from './zoom-controls'
import { syncZoomControls } from './zoom-readout'
import { autoFitDiagram, fitOverview } from './zoom'

function onDiagramWheel(scrollport: HTMLElement, ev: WheelEvent): void {
  if (!ev.ctrlKey && !ev.metaKey) return
  ev.preventDefault()
  zoomByWheel(scrollport, ev.deltaY, ev.deltaMode)
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
  if (view.mode.kind === 'overview') {
    // Overview stays on, fitted to the lanes that are left.
    fitOverview(scrollport)
  } else if (view.mode.kind === 'default') {
    // Hiding or showing a participant changes the width to fit.
    view.mode = zoomModeAfter(view.mode, { kind: 'refit' })
    autoFitDiagram(scrollport, false)
  }
  syncDiagramWindow(scrollport)
}

/** What the "More lanes →" button does: what Shift+→ does from the keyboard. */
const SCREEN_RIGHT = { key: 'ArrowRight', shiftKey: true, metaKey: false, ctrlKey: false, altKey: false }

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
    view.mode = zoomModeAfter(view.mode, { kind: 'refit' })
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
    bindFind(diagram, scroll, id)
  })
}
