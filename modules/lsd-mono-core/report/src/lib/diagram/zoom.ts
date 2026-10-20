// Applying a zoom: committing a level with the scroll kept in proportion, the default (fitted)
// view, the fit that follows the width, and Overview's whole-width fit.
import { fittedView, settleFitWidth, overviewScale } from '../diagram-view'
import type { FittedView } from '../diagram-view'
import { DEFAULT_VIEWPORT, HEADER_BLOCK_H } from '../layout'
import { scrollBehavior } from '../media'
import { frameOf, topMessageLabelRect } from './geometry'
import { scrollDiagramToOffset, scrollsWithPage, sizeStage } from './page-scroll'
import { type DiagramView, type MountedDiagram, diagramState, diagramView } from './state'
import { applyDiagramFrame, syncDiagramWindow } from './window'
import { fittedWidthOf, zoomModeAfter } from './zoom-mode'

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
  view.mode = zoomModeAfter(view.mode, { kind: 'reset' })
  const scale = fitted.scale
  const header = HEADER_BLOCK_H * scale
  const pin = centre
    ? {
        top: Math.max(0, centre.y * scale - Math.max(0, scrollport.clientHeight - header) / 2),
        left: Math.max(0, centre.x * scale - scrollport.clientWidth / 2),
      }
    : { top: Math.max(0, fitted.originY) * scale, left: Math.max(0, fitted.originX) * scale }
  commitZoom(scrollport, scale, pin, scrollBehavior())
  view.mode = zoomModeAfter(view.mode, { kind: 'fitted', width: scrollport.clientWidth })
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

/** Refit a diagram the user has not zoomed, now, if its width changed since it was last fitted. */
export function refitDiagram(scrollport: HTMLElement): void {
  autoFitDiagram(scrollport, false)
}

/**
 * Fit a diagram the user has not zoomed (see [ZoomMode]) to the default view, or refit Overview
 * while it is on. Does nothing while its card is collapsed (no width yet), while printing, or
 * when the width is the one it last fitted. `first` scrolls to the top message like the %
 * readout; a refit keeps the scroll position in proportion.
 */
export function autoFitDiagram(scrollport: HTMLElement, first: boolean): void {
  const id = scrollport.dataset.scenarioId
  const diagram = id ? diagramState.mounted.get(id) : undefined
  if (!id || !diagram) return
  const view = diagramView(id)
  const fittedWidth = fittedWidthOf(view.mode)
  if (fittedWidth == null || printing()) return
  const width = scrollport.clientWidth
  if (width <= 0 || Math.abs(width - fittedWidth) <= 1) return
  if (view.mode.kind === 'overview') {
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
  view.mode = zoomModeAfter(view.mode, { kind: 'fitted', width: scrollport.clientWidth })
  syncDiagramWindow(scrollport)
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
  view.mode = zoomModeAfter(view.mode, { kind: 'fitted', width: scrollport.clientWidth })
}
