import type { Insight, Metric } from '../types'
import { insightsListHtml } from './insights'
import { escapeAttr, escapeHtml } from '../lib/escape'

/**
 * Body of the Metrics view in the side panel: the scenario's metrics as a
 * term list, then the ranked duration insights. Each insight's show button
 * carries its scenario id, because the panel sits outside the scenario card.
 */
export function metricsPanelHtml(
  scenarioId: string,
  metrics: Metric[],
  insights: Insight[] | undefined,
  labelMaxWidth: number,
): string {
  const list = insightsListHtml(insights, labelMaxWidth, scenarioId)
  if (!metrics.length && !list) return '<p class="inspector-empty">No metrics for this scenario.</p>'
  const terms = metrics.length
    ? `<dl class="kv">${metrics.map((m) => `<dt>${escapeHtml(m.key)}</dt><dd>${escapeHtml(m.value)}</dd>`).join('')}</dl>`
    : ''
  return `${terms}${list}`
}

/**
 * Print-only copy of the Metrics view, as a card in its scenario. CSS keeps it
 * hidden on screen. It exists only while the Metrics view is open, so a printout
 * has metrics exactly when the user was looking at them.
 */
export function printMetricsSection(
  scenarioId: string,
  metrics: Metric[],
  insights: Insight[] | undefined,
  labelMaxWidth: number,
): string {
  return `<section class="card print-metrics" data-print-metrics="${escapeAttr(scenarioId)}">
    <h3>Metrics</h3>
    ${metricsPanelHtml(scenarioId, metrics, insights, labelMaxWidth)}
  </section>`
}

/**
 * Keep at most one print copy, inside the scenario whose metrics are open: after
 * its summary cards, before its diagram. Null removes it.
 */
export function placePrintMetrics(doc: Document, open: { scenarioId: string; html: string } | null): void {
  doc.querySelectorAll('.print-metrics').forEach((el) => el.remove())
  if (!open) return
  const cards = doc.getElementById(`card-${open.scenarioId}`)?.querySelector('.scenario-body > .cards')
  cards?.insertAdjacentHTML('afterend', open.html)
}
