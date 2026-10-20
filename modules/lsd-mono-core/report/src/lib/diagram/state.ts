// Diagram state: one controller for everything the sequence diagram keeps between renders.
import type { Scenario } from '../../types'
import type { MessagePlace } from '../diagram-a11y'
import { DEFAULT_ZOOM } from '../diagram-view'
import type { ActivationSpan, LayoutRow } from '../layout'
import type { PayloadFind } from './payload-find'
import { defaultMode } from './zoom-mode'

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
  /** Find in payloads, per scenario id: loaded and indexed the first time Find needs them. */
  payloadFind: new Map<string, PayloadFind>(),
  /** The app's side of Find: the panel redraws its marks and follows the current match. */
  findHooks: {} as FindHooks,
}

/** What the app does when Find changes. The diagram code does not know about the side panel. */
export interface FindHooks {
  /** The scenario's query, its payload matches or its payload toggle changed. */
  changed?: (scenarioId: string) => void
  /** Next or Previous made [eventId] the scenario's current match. */
  stepped?: (scenarioId: string, eventId: string) => void
}

export function setFindHooks(hooks: FindHooks): void {
  diagramState.findHooks = hooks
}

/** Forget every diagram and its view: another report's scenarios may reuse the same ids. */
export function forgetDiagrams(): void {
  diagramState.mounted.clear()
  diagramState.views.clear()
  diagramState.payloadFind.clear()
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
  /** The default view, a zoom of the user's own, or Overview: see ZoomMode, and zoom-mode.ts. */
  mode: ZoomMode
  hidden: Set<string>
  query: string
  /** Roving tabindex target. Null means the first focusable message. */
  activeMessageId: string | null
  /** The find match brought on screen (the first one), drawn stronger than the others. */
  searchCurrentId?: string | null
  /** True once Next or Previous moved the current match for this query; a late payload answer then leaves it. */
  searchStepped?: boolean
  /** Whether Find also searches message payloads. On unless the user turns it off. */
  includePayloads: boolean
}

/**
 * How the zoom was chosen. In the default view (see fittedView) the diagram keeps fitting its
 * width: on first render, and again when the panel width changes, until the user zooms in or out
 * (zoomed); the % readout goes back to it. Overview fits the whole width until it is turned off
 * (#94), then goes back to the view it saved. [fittedWidth] is the scrollport width the last fit
 * used, so a resize to the same width does not refit.
 */
export type ZoomMode =
  | { kind: 'default'; fittedWidth: number }
  | { kind: 'zoomed' }
  | { kind: 'overview'; fittedWidth: number; saved: SavedView }

/** A zoom and scroll position to restore, with the mode that went with it. */
export interface SavedView {
  zoom: number
  top: number
  left: number
  mode: Exclude<ZoomMode, { kind: 'overview' }>
}

export interface RowPaint {
  query: string
  hiddenIds: ReadonlySet<string>
  places?: MessagePlace[]
  /** Names for the spoken from and to of each arrow's button. */
  participants?: { id: string; name: string }[]
  activeMessageId?: string | null
  /** Event id of the current find match. */
  searchCurrentId?: string | null
  /** Messages whose payload matches the query. */
  payloadHits?: ReadonlySet<string>
  neighbors?: Map<string, { prevArrowY?: number; nextArrowY?: number }>
  /** Bars for the whole scenario. Arrows attach to the innermost bar at their row. */
  activations?: ActivationSpan[]
  /** Padding around the lifeline area. HTML overlays and full-width bands use it. */
  frame?: DiagramFrame
  /** Smallest open target in CSS px (bigger on touch screens). Absent means MIN_HIT_CSS. */
  minHit?: number
}

export const EMPTY_PAINT: RowPaint = { query: '', hiddenIds: new Set() }

export function diagramView(scenarioId: string): DiagramView {
  let view = diagramState.views.get(scenarioId)
  if (!view) {
    view = {
      zoom: DEFAULT_ZOOM,
      mode: defaultMode(),
      hidden: new Set(),
      query: '',
      activeMessageId: null,
      includePayloads: true,
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
