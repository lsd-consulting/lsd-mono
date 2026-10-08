import type { Insight, Metric } from '../types'
import { insightsListHtml } from './insights'
import { escapeHtml } from './scenario-summary'

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
