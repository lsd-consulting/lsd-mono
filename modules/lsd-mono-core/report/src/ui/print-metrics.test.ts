// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Metric } from '../types'
import { bindInspector, inspectorMarkup } from './inspector'
import { placePrintMetrics, printMetricsSection } from './metrics'

const metrics: Metric[] = [{ key: 'Messages', value: '32' }]
function card(id: string): string {
  return `<article class="scenario-card" id="card-${id}"><div class="scenario-body">
    <div class="cards"><section class="card"><h3>Description</h3></section></div>
    <section class="diagram-panel"></section>
  </div></article>`
}

describe('printMetricsSection', () => {
  it('is a titled card with the metrics, for one scenario', () => {
    const host = document.createElement('div')
    host.innerHTML = printMetricsSection('pay', metrics)
    const section = host.querySelector<HTMLElement>('section.print-metrics')!
    expect(section.dataset.printMetrics).toBe('pay')
    expect(section.querySelector('h3')!.textContent).toBe('Metrics')
    expect(section.querySelector('dl.kv dt')!.textContent).toBe('Messages')
  })
})

describe('placePrintMetrics', () => {
  beforeEach(() => {
    document.body.innerHTML = `<main>${card('pay')}${card('stock')}</main>`
  })

  it('puts the section in its scenario, after the summary cards and before the diagram', () => {
    placePrintMetrics(document, { scenarioId: 'stock', html: printMetricsSection('stock', metrics) })
    const placed = document.querySelectorAll('.print-metrics')
    expect(placed).toHaveLength(1)
    expect(placed[0].closest('.scenario-card')!.id).toBe('card-stock')
    expect(placed[0].previousElementSibling!.classList.contains('cards')).toBe(true)
    expect(placed[0].nextElementSibling!.classList.contains('diagram-panel')).toBe(true)
  })

  it('moves to another scenario and is removed when the Metrics view is not open', () => {
    placePrintMetrics(document, { scenarioId: 'stock', html: printMetricsSection('stock', metrics) })
    placePrintMetrics(document, { scenarioId: 'pay', html: printMetricsSection('pay', metrics) })
    expect([...document.querySelectorAll('.print-metrics')].map((el) => el.closest('.scenario-card')!.id)).toEqual([
      'card-pay',
    ])
    placePrintMetrics(document, null)
    expect(document.querySelectorAll('.print-metrics')).toHaveLength(0)
  })

  it('does nothing when the scenario is not on the page (filtered out)', () => {
    placePrintMetrics(document, { scenarioId: 'gone', html: printMetricsSection('gone', metrics) })
    expect(document.querySelectorAll('.print-metrics')).toHaveLength(0)
  })
})

describe('inspector view marker', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="shell">${inspectorMarkup()}</div>`
  })

  it('names the open view so print CSS can tell metrics from json and a component link', () => {
    const controller = bindInspector(document, { loadPayload: async () => undefined, onClose: () => {} })
    const panel = document.querySelector<HTMLElement>('#inspector')!
    controller.openMetrics('pay', { heading: 'Pay', metrics })
    expect(panel.dataset.view).toBe('metrics')
    controller.openLink(
      'pay',
      { nodes: [], edges: [{ from: 'a', to: 'b', types: ['SYNCHRONOUS'], count: 1 }] },
      0,
      'Pay',
    )
    expect(panel.dataset.view).toBe('link')
    controller.openMessage('pay', { kind: 'message', id: 'm', from: 'a', to: 'b', label: 'x', type: 'SYNCHRONOUS' })
    expect(panel.dataset.view).toBe('message')
    controller.openError({ status: 'error', headline: 'Boom', message: 'bad' })
    expect(panel.dataset.view).toBe('error')
  })
})
