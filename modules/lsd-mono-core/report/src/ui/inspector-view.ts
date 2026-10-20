// What the side panel's shell (inspector.ts) and its views (#103) share: each view (a message,
// an error, a component link, metrics) opens through the shell, which owns sizing, opening,
// Escape and the close button, and says where focus goes when the panel closes on it.
import type { JsonBody } from './inspector-json'
import type { InspectorWidth } from './inspector-width'

export interface InspectorInvoker {
  scenarioId: string
  /** Set for a message. Absent when the panel is showing a component link or metrics. */
  messageId?: string
  kind?: 'message' | 'link' | 'metrics'
  /** A link of the Components view: its index in the component graph (#105). */
  edge?: number
  /** Metrics opened from a timing chip: its place in the strip, so Close gives it focus back. */
  chip?: number | null
}

/** Where focus goes when the panel closes. */
export type FocusReturn =
  | { kind: 'none' }
  /** Back to the scenario card's toolbar button, or to the timing chip [chip] when one opened Metrics. */
  | { kind: 'button'; scenarioId: string; selector: string; chip: number | null }
  | { kind: 'message'; scenarioId: string; messageId: string }

export const NO_FOCUS_RETURN: FocusReturn = { kind: 'none' }

/** One view of the panel. */
export interface PanelView {
  /** The panel is closing on this view: stop what it started. */
  close: () => void
  /** Where focus goes once the panel has closed on [invoker]. */
  focusReturn: (invoker: InspectorInvoker | null) => FocusReturn
}

/** What a view gets from the shell. */
export interface PanelShell {
  doc: Document
  panel: HTMLElement
  title: HTMLElement
  meta: HTMLElement
  lead: HTMLElement
  json: JsonBody
  width: InspectorWidth
  /**
   * Start showing [view] for [invoker] (null: an error): open the panel at its width with the
   * message chrome (JSON row, Copy) and focus it unless [focus] is false. Returns the token that
   * loads for this view must carry.
   */
  begin: (view: PanelView, invoker: InspectorInvoker | null, label?: string, focus?: boolean) => number
  /** A view with no payload: no JSON row, no Copy; only [host] shows. */
  showViewChrome: (host: HTMLElement) => void
  /** On a phone the panel is inline below the report: bring what just opened into view. */
  revealOnPhone: (content?: HTMLElement) => void
  viewport: () => number
}
