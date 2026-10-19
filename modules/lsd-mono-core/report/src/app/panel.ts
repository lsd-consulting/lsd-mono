// The side panel's views (message, error, component diagram, metrics), their payloads, and their print copies.
import { usage } from '../lib/usage-ping'
import { sampleReport } from '../data/sample-report'
import type { MessageEvent, Scenario } from '../types'
import { loadExternalPayloads, loadPayloadsFrom, payloadKey } from '../lib/payloads'
import { placePrintMetrics, printMetricsSection } from '../ui/metrics'
import { timingPanelHtml } from '../ui/timing'
import { placePrintPanel, printComponentsSection, printMessageSection } from '../ui/print-panel'
import { renderComponentDiagram } from '../lib/component-diagram'
import { findMessage } from '../lib/sequence-diagram'
import { componentGraph } from '../lib/component-graph'
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
 * never prints) and the pressed state of the toolbar's Metrics and Component diagram buttons.
 */
export function syncWithPanel(): void {
  syncPrintMetrics()
  syncPrintPanel()
  syncPanelButtons()
}

/** aria-expanded on the toolbar's Metrics and Component diagram buttons: true while that view is open for that scenario. */
function syncPanelButtons(): void {
  const open = session.inspector?.isOpen() ? session.invoker : null
  for (const button of document.querySelectorAll<HTMLButtonElement>('.panel-controls .panel-btn')) {
    const kind = button.dataset.showMetrics !== undefined ? 'metrics' : 'components'
    const scenarioId = button.dataset.showMetrics ?? button.dataset.showComponents
    const expanded = open?.kind === kind && open.scenarioId === scenarioId
    button.setAttribute('aria-expanded', String(expanded))
  }
}

/**
 * The message JSON, error, or component diagram open in the side panel prints in
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
  if (view.view === 'components') {
    const drawn = renderComponentDiagram(componentGraph(scenario), scenario.title)
    placePrintPanel(document, { scenarioId: scenario.id, html: printComponentsSection(view, drawn.svg, drawn.width) })
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

export function openComponents(scenario: Scenario): void {
  if (!session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = { scenarioId: scenario.id, kind: 'components' }
  writeScenarioHash()
  session.inspector.openComponents(scenario.id, componentGraph(scenario), scenario.title)
  syncWithPanel()
  usage.ping('components-open')
}

export function openMetrics(scenario: Scenario): void {
  if (!session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = { scenarioId: scenario.id, kind: 'metrics' }
  writeScenarioHash()
  session.inspector.openMetrics(scenario.id, {
    heading: scenario.title,
    metrics: scenario.metrics,
    timingHtml: timingPanelHtml(scenario),
  })
  syncWithPanel()
  usage.ping('metrics-open')
}

export function openMessage(scenario: Scenario, msg: MessageEvent): void {
  if (!session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = { scenarioId: scenario.id, messageId: msg.id }
  writeHash({ scenarioId: scenario.id, messageId: msg.id })
  session.inspector.openMessage(scenario.id, msg)
  syncWithPanel()
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
