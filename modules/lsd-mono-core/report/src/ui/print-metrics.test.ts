// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Insight, Metric } from '../types'
import { bindInspector, inspectorMarkup } from './inspector'
import { placePrintMetrics, printMetricsSection } from './metrics'

const metrics: Metric[] = [{ key: 'Messages', value: '32' }]
const insight: Insight = {
  rank: 1,
  kind: 'bottleneck',
  participant: 'payment-service',
  label: 'authorise',
  from: 'api',
  to: 'payment-service',
  messageId: 'm7',
  totalMs: 652,
  isolatedMs: 652,
}

function card(id: string): string {
  return `<article class="scenario-card" id="card-${id}"><div class="scenario-body">
    <div class="cards"><section class="card"><h3>Description</h3></section></div>
    <section class="diagram-panel"></section>
  </div></article>`
}

describe('printMetricsSection', () => {
  it('is a titled card with the metrics and insights, for one scenario', () => {
    const host = document.createElement('div')
    host.innerHTML = printMetricsSection('pay', metrics, [insight], 200)
    const section = host.querySelector<HTMLElement>('section.print-metrics')!
    expect(section.dataset.printMetrics).toBe('pay')
    expect(section.querySelector('h3')!.textContent).toBe('Metrics')
    expect(section.querySelector('dl.kv dt')!.textContent).toBe('Messages')
    expect(section.querySelectorAll('ol.insights li')).toHaveLength(1)
  })
})

describe('placePrintMetrics', () => {
  beforeEach(() => {
    document.body.innerHTML = `<main>${card('pay')}${card('stock')}</main>`
  })

  it('puts the section in its scenario, after the summary cards and before the diagram', () => {
    placePrintMetrics(document, { scenarioId: 'stock', html: printMetricsSection('stock', metrics, [], 200) })
    const placed = document.querySelectorAll('.print-metrics')
    expect(placed).toHaveLength(1)
    expect(placed[0].closest('.scenario-card')!.id).toBe('card-stock')
    expect(placed[0].previousElementSibling!.classList.contains('cards')).toBe(true)
    expect(placed[0].nextElementSibling!.classList.contains('diagram-panel')).toBe(true)
  })

  it('moves to another scenario and is removed when the Metrics view is not open', () => {
    placePrintMetrics(document, { scenarioId: 'stock', html: printMetricsSection('stock', metrics, [], 200) })
    placePrintMetrics(document, { scenarioId: 'pay', html: printMetricsSection('pay', metrics, [], 200) })
    expect([...document.querySelectorAll('.print-metrics')].map((el) => el.closest('.scenario-card')!.id)).toEqual([
      'card-pay',
    ])
    placePrintMetrics(document, null)
    expect(document.querySelectorAll('.print-metrics')).toHaveLength(0)
  })

  it('does nothing when the scenario is not on the page (filtered out)', () => {
    placePrintMetrics(document, { scenarioId: 'gone', html: printMetricsSection('gone', metrics, [], 200) })
    expect(document.querySelectorAll('.print-metrics')).toHaveLength(0)
  })
})

describe('inspector view marker', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="shell">${inspectorMarkup()}</div>`
  })

  it('names the open view so print CSS can tell metrics from json and the component diagram', () => {
    const controller = bindInspector(document, { loadPayload: async () => undefined, onClose: () => {} })
    const panel = document.querySelector<HTMLElement>('#inspector')!
    controller.openMetrics('pay', { heading: 'Pay', metrics, insights: [], labelMaxWidth: 200 })
    expect(panel.dataset.view).toBe('metrics')
    controller.openComponents('pay', { nodes: [], edges: [] }, 'Pay')
    expect(panel.dataset.view).toBe('components')
    controller.openMessage('pay', { kind: 'message', id: 'm', from: 'a', to: 'b', label: 'x', type: 'SYNCHRONOUS' })
    expect(panel.dataset.view).toBe('message')
    controller.openError({ status: 'error', headline: 'Boom', message: 'bad' })
    expect(panel.dataset.view).toBe('error')
  })
})
