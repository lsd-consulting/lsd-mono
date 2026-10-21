// The side panel's views (message, error, component link, metrics), their payloads, and their print copies.
import { usage } from '../lib/usage-ping'
import { sampleReport } from '../data/sample-report'
import type { MessageEvent, Scenario } from '../types'
import { loadExternalPayloads, loadPayloadsFrom, payloadKey } from '../lib/payloads'
import { placePrintMetrics, printMetricsSection } from '../ui/metrics'
import { pairAccuracySectionHtml, timingPanelHtml } from '../ui/timing'
import { placePrintPanel, printMessageSection } from '../ui/print-panel'
import { diagramView, findMessage } from '../lib/sequence-diagram'
import { messageHasPayload } from '../lib/diagram-a11y'
import { foldQuery } from '../lib/payload-search'
import type { OpenMessageOptions } from '../ui/inspector'
import { writeHash, writeScenarioHash } from './url-hash'
import { index, session } from './context'
export function scenarioFrom(node: Element): Scenario | undefined {
  const card = node.closest<HTMLElement>('[id^="card-"]')
  if (!card) return
  return session.report.scenarios.find((s) => s.id === card.id.slice('card-'.length))
}

export function openError(scenario: Scenario): void {
  const err = scenario.error
  if (!err || !session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = null
  writeScenarioHash()
  session.inspector.openError({
    status: scenario.status,
    headline: err.headline,
    message: err.message,
    stack: err.stack,
  })
  syncWithPanel()
}

/**
 * Everything that follows what the side panel shows: its print copies (the panel itself
 * never prints) and the pressed state of the toolbar's Metrics buttons.
 */
export function syncWithPanel(): void {
  syncPrintMetrics()
  syncPrintPanel()
  syncPanelButtons()
}

/** aria-expanded on the toolbars' Metrics buttons (one per view): true while Metrics is open for that scenario. */
function syncPanelButtons(): void {
  const open = session.inspector?.isOpen() ? session.invoker : null
  for (const button of document.querySelectorAll<HTMLButtonElement>('.panel-controls .panel-btn')) {
    const expanded = open?.kind === 'metrics' && open.scenarioId === button.dataset.showMetrics
    button.setAttribute('aria-expanded', String(expanded))
  }
}

/**
 * The message JSON, error, or component link open in the side panel prints in
 * its scenario, after the sequence diagram. A closed panel prints nothing.
 */
export function syncPrintPanel(): void {
  const view = session.inspector?.printView() ?? null
  const scenario = session.panelScenarioId
    ? session.report.scenarios.find((item) => item.id === session.panelScenarioId)
    : undefined
  if (!view || !scenario || view.view === 'metrics') {
    placePrintPanel(document, null)
    return
  }
  placePrintPanel(document, { scenarioId: scenario.id, html: printMessageSection(view) })
}

/**
 * Printed metrics follow the side panel: present only while it shows the Metrics
 * view, inside that scenario. Any other view, or a closed panel, prints none.
 */
function syncPrintMetrics(): void {
  const id = session.inspector?.isOpen() && session.invoker?.kind === 'metrics' ? session.invoker.scenarioId : null
  const scenario = id ? session.report.scenarios.find((item) => item.id === id) : undefined
  placePrintMetrics(
    document,
    scenario
      ? {
          scenarioId: scenario.id,
          html: printMetricsSection(scenario.id, scenario.metrics),
        }
      : null,
  )
}

/** Metrics for [scenario], at the top, or at [section] (a `data-panel-section`, e.g. from the Accuracy chip). */
/** [chip]: the timing chip that opened it, which gets focus back on Close (#86). */
export function openMetrics(scenario: Scenario, section?: string, chip: number | null = null): void {
  if (!session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = { scenarioId: scenario.id, kind: 'metrics', chip }
  writeScenarioHash()
  session.inspector.openMetrics(scenario.id, {
    heading: scenario.title,
    metrics: scenario.metrics,
    timingHtml: timingPanelHtml(scenario),
    pairAccuracyHtml: pairAccuracySectionHtml(scenario),
    section,
    chip,
  })
  syncWithPanel()
  usage.ping('metrics-open')
}

export function openMessage(scenario: Scenario, msg: MessageEvent, options?: OpenMessageOptions): void {
  if (!session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = { scenarioId: scenario.id, messageId: msg.id }
  writeHash({ scenarioId: scenario.id, messageId: msg.id })
  session.inspector.openMessage(scenario.id, msg, options)
  syncWithPanel()
}

/**
 * Find in a diagram stepped onto [eventId]. A side panel showing one of that scenario's messages
 * follows to it, keeping focus in Find; a closed panel, or one showing something else, stays as it is.
 */
export function followFind(scenarioId: string, eventId: string): void {
  const open = session.inspector?.isOpen() ? session.invoker : null
  if (!open?.messageId || open.scenarioId !== scenarioId || open.messageId === eventId) return
  const scenario = session.report.scenarios.find((item) => item.id === scenarioId)
  const msg = scenario ? findMessage(scenario, eventId) : undefined
  if (scenario && msg && messageHasPayload(msg)) openMessage(scenario, msg, { focus: false })
}

/** Find's query for the side panel's marks: folded, or '' while payloads are not searched. */
export function panelFindQuery(scenarioId: string): string {
  const view = diagramView(scenarioId)
  return view.includePayloads ? foldQuery(view.query) : ''
}

/** Find changed in [scenarioId]: redraw the marks if the panel shows one of its messages. */
export function refreshPanelFind(scenarioId: string): void {
  if (session.invoker?.messageId && session.invoker.scenarioId === scenarioId) session.inspector?.refreshFind()
}

export function messageFromNode(node: Element): { scenarioId: string; message: MessageEvent } | null {
  const scenario = scenarioFrom(node)
  const messageId = node.getAttribute('data-message-id')
  if (!scenario || !messageId) return null
  const message = findMessage(scenario, messageId)
  if (!message) return null
  return { scenarioId: scenario.id, message }
}

/** The shown report's deferred payloads, keyed by payloadKey: the side panel and Find share one load. */
export function loadPayloadMap(): Promise<Record<string, unknown>> {
  if (index) return session.reportPayloadsSrc ? loadPayloadsFrom(session.reportPayloadsSrc) : Promise.resolve({})
  return loadExternalPayloads(session.report === sampleReport)
}

export async function loadMessagePayload(scenarioId: string, messageId: string): Promise<unknown> {
  const map = await loadPayloadMap()
  const key = payloadKey(scenarioId, messageId)
  if (key in map) return map[key]
  return undefined
}
