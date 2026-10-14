// Diagram state: one controller for everything the sequence diagram keeps between renders.
import type { Scenario } from '../../types'
import type { MessagePlace } from '../diagram-a11y'
import { AUTO_FIT_MAX_ZOOM, DEFAULT_ZOOM } from '../diagram-view'
import type { ActivationSpan, LayoutRow } from '../layout'

/** Everything the sequence diagram keeps between renders, in one place. */
export const diagramState = {
  /** Mounted diagrams by scenario id. */
  mounted: new Map<string, MountedDiagram>(),
  /** Zoom, fit, filter and focus per scenario id. */
  views: new Map<string, DiagramView>(),
  /** When true, paint every row so print is not clipped to the virtual window. */
  printAllRows: false,
  /** One observer for every diagram: refits auto views when their panel width changes. */
  widthObserver: null as ResizeObserver | null,
  observedScrollports: new Set<HTMLElement>(),
  printHooks: false,
  /** True while focusDiagramMessage moves focus, so a repaint does not steal it back. */
  movingFocus: false,
}

/** Forget every diagram and its view: another report's scenarios may reuse the same ids. */
export function forgetDiagrams(): void {
  diagramState.mounted.clear()
  diagramState.views.clear()
}

export interface MountedDiagram {
  scenario: Scenario
  rows: LayoutRow[]
  width: number
  height: number
  labelMaxWidth: number
}

export interface DiagramView {
  zoom: number
  /**
   * True until the user zooms in or out. While it is true the diagram fits its panel: on
   * first render, and again when the panel width changes. Fit makes it true again.
   */
  autoFit: boolean
  /**
   * Largest scale a refit may use: AUTO_FIT_MAX_ZOOM until the user presses Fit, then
   * MAX_ZOOM, so later refits fill the width the way Fit does.
   */
  fitLimit: number
  /** Scrollport width the last fit used, so a resize to the same width does not refit. */
  fittedWidth: number
  hidden: Set<string>
  query: string
  /** Roving tabindex target. Null means the first focusable message. */
  activeMessageId: string | null
}

export interface RowPaint {
  query: string
  hiddenIds: ReadonlySet<string>
  places?: MessagePlace[]
  activeMessageId?: string | null
  neighbors?: Map<string, { prevArrowY?: number; nextArrowY?: number }>
  /** Bars for the whole scenario. Arrows attach to the innermost bar at their row. */
  activations?: ActivationSpan[]
  /** Padding around the lifeline area. HTML overlays and full-width bands use it. */
  frame?: DiagramFrame
}

export const EMPTY_PAINT: RowPaint = { query: '', hiddenIds: new Set() }

export function diagramView(scenarioId: string): DiagramView {
  let view = diagramState.views.get(scenarioId)
  if (!view) {
    view = {
      zoom: DEFAULT_ZOOM,
      autoFit: true,
      fitLimit: AUTO_FIT_MAX_ZOOM,
      fittedWidth: 0,
      hidden: new Set(),
      query: '',
      activeMessageId: null,
    }
    diagramState.views.set(scenarioId, view)
  }
  return view
}

/**
 * Horizontal frame of a diagram. Lifelines are laid out across [base], from
 * x = 0. Notes, self-call labels and short-arrow labels on the outer lifelines
 * can reach past that, so the drawing adds [left] and [right] and the SVG
 * viewBox starts at -left.
 */
export interface DiagramFrame {
  base: number
  left: number
  right: number
  total: number
}
