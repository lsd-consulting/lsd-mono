import type { MessageEvent } from '../types'
import type { ComponentGraph } from '../lib/component-graph'
import { INSPECTOR_MIN_PX, INSPECTOR_NARROW_PX } from './inspector-width'
import type { FocusReturn, InspectorInvoker } from './inspector-view'
import { bindPanelShell, type PanelPrintView } from './inspector-shell'
import { bindErrorView, bindMessageView } from './inspector-message'
import { bindLinkView } from './inspector-link'
import { bindMetricsView, type MetricsView } from './inspector-metrics'
import { trackHeightVar } from '../lib/topbar-height'

export type { PanelPrintView } from './inspector-shell'
export type { FocusReturn, InspectorInvoker } from './inspector-view'
export type { MetricsView } from './inspector-metrics'

export interface InspectorOptions {
  /** Full payload for a deferred message. Not called when the message already holds its whole payload. */
  loadPayload: (scenarioId: string, messageId: string) => Promise<unknown>
  /**
   * Escape and the close control. [focus] is where the view that was showing gives focus back:
   * the invoking arrow, toolbar button or timing chip.
   */
  onClose: (invoker: InspectorInvoker | null, focus: FocusReturn) => void
  /** The JSON (or stack) shown in the panel changed: loaded, shown, or hidden. */
  onContent?: () => void
  /** Find's query for a scenario's payloads, folded, or '' when nothing should be marked. */
  findQuery?: (scenarioId: string) => string
}

/** How a message opens. Find following its current match leaves focus where it is. */
export interface OpenMessageOptions {
  focus?: boolean
}

export interface InspectorController {
  openMessage: (scenarioId: string, message: MessageEvent, options?: OpenMessageOptions) => void
  /** One link of a scenario's Components view and its interactions (#105). */
  openLink: (scenarioId: string, graph: ComponentGraph, edgeIndex: number, title: string) => void
  /** Scenario timing and metrics, in this same panel. No JSON or Copy. */
  openMetrics: (scenarioId: string, view: MetricsView) => void
  openError: (error: { status: string; headline: string; message: string; stack?: string }) => void
  close: () => void
  isOpen: () => boolean
  /** Null while the panel is closed. */
  printView: () => PanelPrintView | null
  /** Find's query changed: redraw its marks in the JSON shown. */
  refreshFind: () => void
}

/**
 * Side panel. Not a dialog: the rest of the page stays active, and nothing sets aria-modal.
 * Focus moves into the panel. Escape and Close give it back to the arrow that opened it.
 * JSON is shown once its payload has loaded. Hide collapses it again.
 */
export function inspectorMarkup(): string {
  return `
    <aside id="inspector" class="inspector" hidden tabindex="-1" aria-labelledby="inspector-title">
      <div id="inspector-resize" class="inspector-resize" role="separator" aria-orientation="vertical" aria-label="Resize message panel" aria-valuemin="${INSPECTOR_MIN_PX}" aria-valuemax="900" aria-valuenow="${INSPECTOR_NARROW_PX}" tabindex="0"></div>
      <div class="inspector-head">
        <h2 id="inspector-title">Message</h2>
        <button type="button" class="icon-btn" id="inspector-copy" title="Copy payload">Copy</button>
        <button type="button" class="icon-btn" id="inspector-close" title="Close (Esc)" aria-label="Close">Close</button>
      </div>
      <div class="inspector-body">
        <div class="meta-row" id="inspector-meta"></div>
        <p id="inspector-lead" hidden></p>
        <div id="inspector-link" hidden></div>
        <div id="inspector-metrics" hidden></div>
        <div class="json-row">
          <button type="button" id="inspector-json" aria-expanded="false" aria-controls="inspector-pre">Show JSON</button>
          <button type="button" id="inspector-json-expand" hidden aria-pressed="false" aria-controls="inspector-pre">Expand</button>
        </div>
        <div class="json-find" id="inspector-find" role="group" aria-label="Find matches in this payload" hidden>
          <span class="json-find-count" aria-live="polite"></span>
          <button type="button" data-json-step="prev" aria-label="Previous match in payload" title="Previous match in payload">↑</button>
          <button type="button" data-json-step="next" aria-label="Next match in payload" title="Next match in payload">↓</button>
        </div>
        <pre id="inspector-pre" hidden></pre>
      </div>
    </aside>`
}

/**
 * The side panel: its shell (inspector-shell.ts) and one controller per view, each behind
 * PanelView (inspector-view.ts).
 */
export function bindInspector(doc: Document, options: InspectorOptions): InspectorController {
  const panel = bindPanelShell(doc, options)
  const message = bindMessageView(panel.shell, options.loadPayload)
  const error = bindErrorView(panel.shell)
  const link = bindLinkView(panel.shell, panel.linkHost)
  const metrics = bindMetricsView(panel.shell, panel.metricsHost)
  const aside = doc.getElementById('inspector')
  const head = aside?.querySelector<HTMLElement>('.inspector-head')
  if (aside && head) trackHeightVar(head, aside, '--inspector-head-h')
  return {
    isOpen: panel.isOpen,
    close: panel.close,
    printView: panel.printView,
    refreshFind: panel.refreshFind,
    openMessage: (scenarioId, msg, open = {}) => message.open(scenarioId, msg, open.focus ?? true),
    openLink: (scenarioId, graph, edge, heading) => link.open(scenarioId, graph, edge, heading),
    openMetrics: (scenarioId, view) => metrics.open(scenarioId, view),
    openError: (err) => error.open(err),
  }
}

/**
 * Click, Enter, and Space on an arrow button open the same inspector.
 * Returns true when this event was that activation.
 */
export function delegateMessageOpen(
  event: Event,
  lookup: (node: Element) => { scenarioId: string; message: MessageEvent } | null,
  open: (scenarioId: string, message: MessageEvent) => void,
): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const button = target.closest('button.msg-open')
  if (!button) return false
  if (event.type === 'keydown') {
    const key = (event as KeyboardEvent).key
    if (key !== 'Enter' && key !== ' ') return false
    event.preventDefault()
  } else if (event.type !== 'click') {
    return false
  }
  const found = lookup(button)
  if (!found) return false
  open(found.scenarioId, found.message)
  return true
}
