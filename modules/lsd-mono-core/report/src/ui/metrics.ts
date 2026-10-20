import type { Metric } from '../types'
import { escapeAttr, escapeHtml } from '../lib/escape'

/**
 * Body of the Metrics view in the side panel: the scenario's metrics as a term list.
 * Slow calls are in the Timing view above it (summary strip, swim lanes, waterfall).
 */
export function metricsPanelHtml(metrics: Metric[]): string {
  if (!metrics.length) return '<p class="inspector-empty">No metrics for this scenario.</p>'
  return `<dl class="kv">${metrics.map((m) => `<dt>${escapeHtml(m.key)}</dt><dd>${escapeHtml(m.value)}</dd>`).join('')}</dl>`
}

/**
 * The metrics list as a section of the Timing and metrics panel, under its own heading so it can
 * be found among the timing sections. The Metrics view without timing has the panel title instead.
 */
export function metricsSectionHtml(metrics: Metric[]): string {
  return `<div class="panel-section" data-panel-section="metrics">
    <h3>Metrics</h3>
    ${metricsPanelHtml(metrics)}
  </div>`
}

/**
 * Print-only copy of the Metrics view, as a card in its scenario. CSS keeps it
 * hidden on screen. It exists only while the Metrics view is open, so a printout
 * has metrics exactly when the user was looking at them.
 */
export function printMetricsSection(scenarioId: string, metrics: Metric[]): string {
  return `<section class="card print-metrics" data-print-metrics="${escapeAttr(scenarioId)}">
    <h3>Metrics</h3>
    ${metricsPanelHtml(metrics)}
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
