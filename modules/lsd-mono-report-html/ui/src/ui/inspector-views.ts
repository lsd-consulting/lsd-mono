// What each inspector view shows: its pills and body markup. bindInspector owns the panel and its state.
import type { MessageEvent } from '../types'
import { edgeInteractions, typeCue, type ComponentEdge, type ComponentGraph } from '../lib/component-graph'
import { escapeAttr, escapeHtml } from '../lib/escape'
import { isErrorStatus } from '../lib/status'
import type { MetricsView } from './inspector'
import { metricsPanelHtml, metricsSectionHtml } from './metrics'

/** Pills for a message: type, direction, duration, timing, order and pairing cues, request summary. */
export function messageMetaHtml(scenarioId: string, message: MessageEvent): string {
  return `
        <span class="pill">${escapeHtml(message.type)}</span>
        <span class="pill">${escapeHtml(message.from)} → ${escapeHtml(message.to)}</span>
        ${message.durationMs != null ? `<span class="pill">${escapeHtml(message.durationMs)} ms</span>` : ''}
        ${message.timing && message.timing !== 'none' ? `<span class="pill">${escapeHtml(message.timing.toLowerCase())}</span>` : ''}
        ${message.order === 'clock' ? '<span class="pill clock">clock-ordered</span>' : ''}
        ${message.pairing === 'guessed' ? '<span class="pill">guessed pairing</span>' : ''}
        ${statusPill(message.status)}
        ${summaryPills(message.data, message.status)}
        <span class="pill">${escapeHtml(scenarioId)}</span>`
}

/** A link's panel title: "Order Service → Payment Service". */
export function componentLinkTitle(graph: ComponentGraph, edge: ComponentEdge): string {
  const name = (id: string) => graph.nodes.find((node) => node.id === id)?.name ?? id
  return `${name(edge.from)} → ${name(edge.to)}`
}

export function componentLinkMetaHtml(edge: ComponentEdge, heading: string): string {
  const total = `${edge.count} ${edge.count === 1 ? 'interaction' : 'interactions'}`
  return `<span class="pill">${total}</span>
        <span class="pill">${escapeHtml(heading)}</span>`
}

/**
 * One link's interactions, each with a button to its (first) message in the sequence diagram.
 * The buttons' names start with their visible text and add the label, so a list of them is told apart.
 */
export function componentLinkHtml(scenarioId: string, edge: ComponentEdge): string {
  const items = edgeInteractions(edge)
    .map((item) => {
      const cue = item.type.split(', ').map(typeCue).join(', ')
      const times = item.count > 1 ? ` ×${item.count}` : ''
      const label = item.label || '(no label)'
      const first = item.messageIds?.[0]
      const show = first
        ? ` <button type="button" class="text-btn show-in-sequence" data-show-in-sequence="${escapeAttr(first)}" data-scenario-id="${escapeAttr(scenarioId)}" aria-label="${escapeAttr(`Show in sequence: ${label}`)}">Show in sequence</button>`
        : ''
      return `<li><span class="link-item">${escapeHtml(label)} <span class="cue">· ${escapeHtml(cue)}${times}</span></span>${show}</li>`
    })
    .join('')
  return `<ol class="component-links">${items}</ol>`
}

export function metricsTitle(view: MetricsView): string {
  return view.timingHtml ? 'Timing and metrics' : 'Metrics'
}

export function metricsMetaHtml(view: MetricsView): string {
  const count = view.metrics.length
  return `
        <span class="pill">${count} ${count === 1 ? 'metric' : 'metrics'}</span>
        <span class="pill">${escapeHtml(view.heading)}</span>`
}

/**
 * The Timing view, when there is one, then the metrics under their own heading, then Accuracy by
 * pair (drill-down detail) last. Without timing, just the metrics.
 */
export function metricsBodyHtml(scenarioId: string, view: MetricsView): string {
  if (!view.timingHtml) return metricsPanelHtml(view.metrics)
  return view.timingHtml + metricsSectionHtml(view.metrics) + (view.pairAccuracyHtml ?? '')
}

export function errorMetaHtml(error: { status: string; headline: string }): string {
  return `
        <span class="pill">${escapeHtml(error.status)}</span>
        <span class="pill">${escapeHtml(error.headline)}</span>`
}

/** The interaction's status; an error says so in words, so the colour is only a cue. */
function statusPill(status: string | undefined): string {
  if (!status) return ''
  return isErrorStatus(status)
    ? `<span class="pill error" title="Counted in the Errors metric">${escapeHtml(status)} · error</span>`
    : `<span class="pill">${escapeHtml(status)}</span>`
}

/** Request summary pills; a payload status that repeats the interaction status is left out. */
function summaryPills(data: unknown, status?: string): string {
  if (!isRecord(data)) return ''
  const pills: string[] = []
  if (typeof data.method === 'string' && data.method) pills.push(`<span class="pill">${escapeHtml(data.method)}</span>`)
  if (typeof data.path === 'string' && data.path) pills.push(`<span class="pill">${escapeHtml(data.path)}</span>`)
  if (
    ((typeof data.status === 'string' && data.status) || typeof data.status === 'number') &&
    String(data.status) !== status
  )
    pills.push(`<span class="pill">${escapeHtml(data.status)}</span>`)
  return pills.join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
