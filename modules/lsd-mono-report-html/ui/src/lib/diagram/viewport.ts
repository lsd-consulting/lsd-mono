// Binding a mounted diagram: its frame and fit, scrolling, the width observer, Ctrl/Cmd+wheel,
// the zoom controls, the participant filter and Find. Each part lives in its own module.
import { focusablePlaces, messagePlaces } from '../diagram-a11y'
import { bindParticipantFilter } from '../participant-filter'
import { bindPageScroll } from './page-scroll'
import { flushDiagramPaints, invalidate } from './invalidate'
import { diagramState, diagramView } from './state'
import { zoomModeAfter } from './zoom-mode'
import { bindFind } from './find-binding'
import { ensurePrintHooks } from './print-hooks'
import { showMoreLanes } from './more-lanes'
import { syncDiagramWindow, withTrialFrames } from './window'
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
    // Resize observers run after this frame's animation callbacks, just before it is painted: a
    // refit painted at the next frame would leave this one showing the rows at the old zoom.
    flushDiagramPaints()
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
  withTrialFrames(scrollport, (resize) => {
    // Sized for the lanes left first, so a fit keeps the scroll position they leave.
    resize()
    // Hiding or showing a participant changes the width to fit, now or on leaving Overview.
    view.mode = zoomModeAfter(view.mode, { kind: 'lanes-changed' })
    if (view.mode.kind === 'overview') {
      // Overview stays on, fitted to the lanes that are left.
      fitOverview(scrollport)
    } else if (view.mode.kind === 'default') autoFitDiagram(scrollport, false)
  })
  // The header is drawn (withTrialFrames), so the filter can move focus into it; the rows and
  // Find's count (matches in hidden lanes drop out) repaint with the next frame.
  invalidate(id, ['window', 'find'])
}

export function bindDiagramScroll(root: ParentNode): void {
  ensurePrintHooks()
  root.querySelectorAll<HTMLElement>('.seq-diagram').forEach((diagram) => {
    const scroll = diagram.querySelector<HTMLElement>('.seq-scroll')
    if (!scroll?.dataset.scenarioId) return
    const id = scroll.dataset.scenarioId
    // Fit before anything scrolls to a message (deep link, Timing view row), so that scroll uses
    // the fitted zoom. A re-render keeps the fit it already has.
    withTrialFrames(scroll, (resize) => {
      resize()
      const view = diagramView(id)
      view.mode = zoomModeAfter(view.mode, { kind: 'refit' })
      autoFitDiagram(scroll, true)
    })
    syncDiagramWindow(scroll)
    observeWidth(scroll)
    scroll.addEventListener('scroll', () => syncDiagramWindow(scroll), { passive: true })
    bindPageScroll(scroll)
    scroll.addEventListener('wheel', (ev) => onDiagramWheel(scroll, ev), { passive: false })
    bindZoomControls(diagram, scroll)
    // The "More lanes" cues (the pill, and on a phone the edge tab and the toolbar button) are
    // buttons: each scrolls one screen right, and a click never reaches the arrow underneath (#65).
    diagram.querySelectorAll<HTMLButtonElement>('[data-more-lanes]').forEach((button) =>
      button.addEventListener('click', (ev) => {
        ev.stopPropagation()
        showMoreLanes(scroll)
      }),
    )
    bindParticipantFilter(diagram, {
      participants: () => diagramState.mounted.get(id)?.scenario.participants ?? [],
      hidden: () => diagramView(id).hidden,
      setHidden: (next) => setHiddenParticipants(scroll, next),
    })
    bindFind(diagram, scroll, id)
  })
}
