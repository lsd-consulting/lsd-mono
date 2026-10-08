// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Insight, MessageEvent, Metric, Scenario } from '../types'
import { renderDiagramHtml } from '../lib/sequence-diagram'
import { bindInspector, inspectorMarkup } from './inspector'
import { metricsPanelHtml } from './metrics'

const metrics: Metric[] = [
  { key: 'Messages', value: '14' },
  { key: 'Captured duration', value: '1210 ms' },
]
const insight: Insight = {
  rank: 1,
  kind: 'bottleneck',
  participant: 'payment-service',
  label: 'authorise £42.00',
  from: 'api',
  to: 'payment-service',
  messageId: 'm7',
  totalMs: 652,
  isolatedMs: 652,
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'pay',
    title: 'Happy path',
    status: 'success',
    description: '',
    facts: [],
    metrics,
    insights: [insight],
    participants: [
      { id: 'api', name: 'API', type: 'PARTICIPANT' },
      { id: 'payment-service', name: 'Payments', type: 'PARTICIPANT' },
    ],
    events: [{ kind: 'message', id: 'm7', from: 'api', to: 'payment-service', label: 'authorise', type: 'SYNCHRONOUS' }],
    ...overrides,
  }
}

function toolbarOf(html: string): string {
  return html.slice(html.indexOf('class="seq-toolbar"'), html.indexOf('class="seq-stage"'))
}

describe('metrics button', () => {
  it('sits next to the component diagram button and names the scenario it opens', () => {
    const toolbar = toolbarOf(renderDiagramHtml(scenario()))
    expect(toolbar).toMatch(/data-show-metrics="pay"[^>]*>Metrics<\/button>\s*<button[^>]*data-show-components="pay"/)
    expect(toolbar).not.toMatch(/data-show-metrics="pay"[^>]*disabled/)
  })

  it('is enabled for insights alone and disabled when there is nothing to show', () => {
    expect(toolbarOf(renderDiagramHtml(scenario({ metrics: [] })))).not.toMatch(/data-show-metrics="pay"[^>]*disabled/)
    expect(toolbarOf(renderDiagramHtml(scenario({ metrics: [], insights: undefined })))).toMatch(
      /data-show-metrics="pay"[^>]*disabled/,
    )
  })
})

describe('metricsPanelHtml', () => {
  it('lists the metrics and the ranked insights, and ties each show button to its scenario', () => {
    const host = document.createElement('div')
    host.innerHTML = metricsPanelHtml('pay', metrics, [insight], 200)
    const terms = [...host.querySelectorAll('dl.kv dt')].map((dt) => dt.textContent)
    const values = [...host.querySelectorAll('dl.kv dd')].map((dd) => dd.textContent)
    expect(terms).toEqual(['Messages', 'Captured duration'])
    expect(values).toEqual(['14', '1210 ms'])
    const show = host.querySelector<HTMLButtonElement>('ol.insights button[data-show-message="m7"]')!
    expect(show.dataset.scenarioId).toBe('pay')
  })

  it('says so when there is nothing to show', () => {
    expect(metricsPanelHtml('pay', [], [], 200)).toContain('No metrics')
  })

  it('escapes metric keys and values', () => {
    const html = metricsPanelHtml('pay', [{ key: '<b>', value: '<i>' }], [], 200)
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
  })
})

describe('metrics in the side panel', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.body.innerHTML = `<div class="shell" id="shell">${inspectorMarkup()}</div>`
  })

  it('shows metrics without json controls, closes back to its invoker, and a message restores the json chrome', () => {
    const closed: Array<string | undefined> = []
    const controller = bindInspector(document, {
      loadPayload: async () => ({ ok: true }),
      onClose: (invoker) => closed.push(invoker?.kind),
    })
    controller.openMetrics('pay', { heading: 'Happy path', metrics, insights: [insight], labelMaxWidth: 200 })

    const panel = document.querySelector<HTMLElement>('#inspector')!
    const host = document.querySelector<HTMLElement>('#inspector-metrics')!
    expect(panel.hidden).toBe(false)
    expect(document.activeElement).toBe(panel)
    expect(document.querySelector('#inspector-title')!.textContent).toBe('Metrics')
    expect(document.querySelector('#inspector-meta')!.textContent).toContain('2 metrics')
    expect(document.querySelector('#inspector-meta')!.textContent).toContain('1 insight')
    expect(document.querySelector('#inspector-meta')!.textContent).toContain('Happy path')
    expect(host.hidden).toBe(false)
    expect(host.querySelectorAll('dl.kv dt')).toHaveLength(2)
    expect(host.querySelector('ol.insights')).not.toBeNull()
    expect(document.querySelector<HTMLElement>('#inspector-graph')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('.json-row')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#inspector-copy')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#inspector-pre')!.hidden).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel.hidden).toBe(true)
    expect(closed).toEqual(['metrics'])

    controller.openMetrics('pay', { heading: 'Happy path', metrics, insights: [], labelMaxWidth: 200 })
    const message: MessageEvent = { kind: 'message', id: 'm7', from: 'api', to: 'payment-service', label: 'authorise', type: 'SYNCHRONOUS', data: { ok: true } }
    controller.openMessage('pay', message)
    expect(host.hidden).toBe(true)
    expect(host.childElementCount).toBe(0)
    expect(document.querySelector<HTMLElement>('.json-row')!.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('#inspector-copy')!.hidden).toBe(false)

    controller.openMetrics('pay', { heading: 'Happy path', metrics, insights: [], labelMaxWidth: 200 })
    document.querySelector<HTMLButtonElement>('#inspector-close')!.click()
    expect(closed).toEqual(['metrics', 'metrics'])
  })

  it('swapping to the component diagram clears the metrics view', () => {
    const controller = bindInspector(document, { loadPayload: async () => undefined, onClose: () => {} })
    controller.openMetrics('pay', { heading: 'Happy path', metrics, insights: [insight], labelMaxWidth: 200 })
    controller.openComponents('pay', { nodes: [], edges: [] }, 'Happy path')
    const host = document.querySelector<HTMLElement>('#inspector-metrics')!
    expect(host.hidden).toBe(true)
    expect(host.childElementCount).toBe(0)
    expect(document.querySelector<HTMLElement>('#inspector-graph')!.hidden).toBe(false)
  })
})
