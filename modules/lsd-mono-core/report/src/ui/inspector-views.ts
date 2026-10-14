// What each inspector view shows: its pills and body markup. bindInspector owns the panel and its state.
import type { MessageEvent } from '../types'
import { edgeInteractions, typeCue, type ComponentEdge, type ComponentGraph } from '../lib/component-graph'
import { escapeHtml } from '../lib/escape'
import type { MetricsView } from './inspector'
import { metricsPanelHtml } from './metrics'

/** Pills for a message: type, direction, duration, timing, order and pairing cues, request summary. */
export function messageMetaHtml(scenarioId: string, message: MessageEvent): string {
  return `
        <span class="pill">${escapeHtml(message.type)}</span>
        <span class="pill">${escapeHtml(message.from)} → ${escapeHtml(message.to)}</span>
        ${message.durationMs != null ? `<span class="pill">${escapeHtml(message.durationMs)} ms</span>` : ''}
        ${message.timing && message.timing !== 'NONE' ? `<span class="pill">${escapeHtml(message.timing.toLowerCase())}</span>` : ''}
        ${message.order === 'CLOCK' ? '<span class="pill clock">clock-ordered</span>' : ''}
        ${message.pairing === 'GUESSED' ? '<span class="pill">guessed pairing</span>' : ''}
        ${summaryPills(message.data)}
        <span class="pill">${escapeHtml(scenarioId)}</span>`
}

export function componentsMetaHtml(graph: ComponentGraph, heading: string): string {
  const nodes = graph.nodes.length
  const links = graph.edges.length
  return nodes
    ? `<span class="pill">${nodes} ${nodes === 1 ? 'component' : 'components'}</span>
        <span class="pill">${links} ${links === 1 ? 'link' : 'links'}</span>
        <span class="pill">${escapeHtml(heading)}</span>`
    : `<span class="pill">Nothing to draw</span>
        <span class="pill">${escapeHtml(heading)}</span>`
}

/** The drawing, then the list a clicked link fills. */
export function componentsBodyHtml(drawnSvg: string, graph: ComponentGraph): string {
  const hint = graph.edges.length
    ? '<p class="inspector-empty">Hover over a link to see its messages, or click it to list them here.</p>'
    : ''
  return `${drawnSvg}<div class="component-links" aria-live="polite">${hint}</div>`
}

/** One link's interactions, listed under the drawing. */
export function componentLinkHtml(graph: ComponentGraph, edge: ComponentEdge): string {
  const name = (id: string) => graph.nodes.find((node) => node.id === id)?.name ?? id
  const items = edgeInteractions(edge)
    .map((item) => {
      const cue = item.type.split(', ').map(typeCue).join(', ')
      const times = item.count > 1 ? ` ×${item.count}` : ''
      return `<li>${escapeHtml(item.label || '(no label)')} <span class="cue">· ${escapeHtml(cue)}${times}</span></li>`
    })
    .join('')
  const total = `${edge.count} ${edge.count === 1 ? 'interaction' : 'interactions'}`
  return `<h3>${escapeHtml(name(edge.from))} → ${escapeHtml(name(edge.to))} <span class="cue">(${total})</span></h3><ol>${items}</ol>`
}

export function metricsTitle(view: MetricsView): string {
  return view.timingHtml ? 'Timing and metrics' : 'Metrics'
}

export function metricsMetaHtml(view: MetricsView): string {
  const count = view.metrics.length
  const ranked = view.insights?.length ?? 0
  return `
        <span class="pill">${count} ${count === 1 ? 'metric' : 'metrics'}</span>
        ${ranked ? `<span class="pill">${ranked} ${ranked === 1 ? 'insight' : 'insights'}</span>` : ''}
        <span class="pill">${escapeHtml(view.heading)}</span>`
}

/** The Timing view, when there is one, above the metrics and insights. */
export function metricsBodyHtml(scenarioId: string, view: MetricsView): string {
  return (view.timingHtml ?? '') + metricsPanelHtml(scenarioId, view.metrics, view.insights, view.labelMaxWidth)
}

export function errorMetaHtml(error: { status: string; headline: string }): string {
  return `
        <span class="pill">${escapeHtml(error.status)}</span>
        <span class="pill">${escapeHtml(error.headline)}</span>`
}

export function summaryPills(data: unknown): string {
  if (!isRecord(data)) return ''
  const pills: string[] = []
  if (typeof data.method === 'string' && data.method) pills.push(`<span class="pill">${escapeHtml(data.method)}</span>`)
  if (typeof data.path === 'string' && data.path) pills.push(`<span class="pill">${escapeHtml(data.path)}</span>`)
  if ((typeof data.status === 'string' && data.status) || typeof data.status === 'number')
    pills.push(`<span class="pill">${escapeHtml(data.status)}</span>`)
  return pills.join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
