import type { Report } from '../types'
import type { InspectorController, InspectorInvoker } from './inspector'

/**
 * The report page's mutable state, in one place (as `diagramState` is for diagrams). main.ts
 * owns the one instance; filters and the selection are in its separate `state`.
 */
export interface Session {
  /** The report shown. On the index page it changes as reports are opened; empty until the first one loads. */
  report: Report
  /** Index page: the open report's id, and its payload script. */
  reportId: string | null
  reportPayloadsSrc: string | null
  /** Index page: the report being loaded, so a slower earlier load cannot replace a later choice. */
  loadingReportId: string | null
  /** Scenario whose card is in the main column now. Null while the empty state shows. */
  renderedId: string | null
  /** True while a selection change closes the side panel: its focus return has nowhere to go. */
  switchingScenario: boolean
  /** False until the URL hash has been read, so the first render cannot overwrite a #msg= link. */
  booted: boolean
  /** Arrow, Metrics or Component diagram button that opened the inspector. Close returns focus here. */
  invoker: InspectorInvoker | null
  inspector: InspectorController | null
  /** Scenario the side panel is showing, for its print copy. Errors have no invoker, so it is kept here. */
  panelScenarioId: string | null
  /** Suppress hashchange while we write the hash ourselves. */
  writingHash: boolean
  /** Stops the top-bar height observer of the last rendered shell. */
  stopTopbarTracking: () => void
}

/** A session showing [report], before boot: nothing rendered, loaded or open. */
export function createSession(report: Report): Session {
  return {
    report,
    reportId: null,
    reportPayloadsSrc: null,
    loadingReportId: null,
    renderedId: null,
    switchingScenario: false,
    booted: false,
    invoker: null,
    inspector: null,
    panelScenarioId: null,
    writingHash: false,
    stopTopbarTracking: () => {},
  }
}
