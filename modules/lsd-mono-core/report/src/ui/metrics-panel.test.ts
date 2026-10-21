// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { MessageEvent, Metric, Scenario } from '../types'
import { renderDiagramHtml } from '../lib/sequence-diagram'
import { bindInspector, inspectorMarkup } from './inspector'
import { metricsPanelHtml } from './metrics'
import { createKeyRouter } from '../lib/keys/router'
import type { InspectorController } from './inspector'
import { untimed } from '../lib/report-fixture.test-util'
/** Escape as the page's key router gives it to the side panel (#102). */
function pressEscape(controller: InspectorController): void {
  const router = createKeyRouter(() => ({
    dialog: null,
    panel: { open: controller.isOpen() },
    diagram: null,
    page: null,
  }))
  router.on('panel', 'close-panel', () => controller.close())
  router.dispatch(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

const metrics: Metric[] = [
  { key: 'Messages', value: '14' },
  { key: 'Captured duration', value: '1210 ms' },
]
function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    ...untimed(),
    id: 'pay',
    title: 'Happy path',
    status: 'success',
    description: '',
    facts: [],
    metrics,
    participants: [
      { id: 'api', name: 'API', type: 'PARTICIPANT' },
      { id: 'payment-service', name: 'Payments', type: 'PARTICIPANT' },
    ],
    events: [
      { kind: 'message', id: 'm7', from: 'api', to: 'payment-service', label: 'authorise', type: 'SYNCHRONOUS' },
    ],
    ...overrides,
  }
}

function toolbarOf(html: string): string {
  return html.slice(html.indexOf('class="seq-toolbar"'), html.indexOf('class="seq-stage"'))
}

describe('metrics button', () => {
  it('sits in the side panel group, alone now the component diagram is a view (#105), and names the scenario it opens', () => {
    const toolbar = toolbarOf(renderDiagramHtml(scenario()))
    expect(toolbar).toMatch(
      /aria-label="Open in the side panel"><button[^>]*data-show-metrics="pay"[^>]*>(?:(?!<\/button>).)*<span>Metrics<\/span><\/button><\/div>/s,
    )
    expect(toolbar).not.toMatch(/data-show-metrics="pay"[^>]*disabled/)
  })

  it('is left out when there are no metrics, with its group', () => {
    const toolbar = toolbarOf(renderDiagramHtml(scenario({ metrics: [] })))
    expect(toolbar).not.toContain('data-show-metrics')
    expect(toolbar).not.toContain('panel-controls')
  })
})

describe('side panel buttons', () => {
  it('say they open the side panel, closed until the app marks one open, named by their text alone', () => {
    const host = document.createElement('div')
    host.innerHTML = renderDiagramHtml(scenario())
    for (const [selector, text] of [['[data-show-metrics]', 'Metrics']] as const) {
      const button = host.querySelector<HTMLButtonElement>(`.panel-controls ${selector}`)!
      expect(button.getAttribute('aria-controls')).toBe('inspector')
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(button.textContent?.trim()).toBe(text)
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
      expect(button.hasAttribute('aria-label')).toBe(false)
    }
  })
})

describe('metricsPanelHtml', () => {
  it('lists the metrics, and no ranked duration insights', () => {
    const host = document.createElement('div')
    host.innerHTML = metricsPanelHtml(metrics)
    const terms = [...host.querySelectorAll('dl.kv dt')].map((dt) => dt.textContent)
    const values = [...host.querySelectorAll('dl.kv dd')].map((dd) => dd.textContent)
    expect(terms).toEqual(['Messages', 'Captured duration'])
    expect(values).toEqual(['14', '1210 ms'])
    expect(host.querySelector('ol.insights')).toBeNull()
    expect(host.querySelector('[data-show-message]')).toBeNull()
  })

  it('says so when there is nothing to show', () => {
    expect(metricsPanelHtml([])).toContain('No metrics')
  })

  it('escapes metric keys and values', () => {
    const html = metricsPanelHtml([{ key: '<b>', value: '<i>' }])
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
    controller.openMetrics('pay', { heading: 'Happy path', metrics })

    const panel = document.querySelector<HTMLElement>('#inspector')!
    const host = document.querySelector<HTMLElement>('#inspector-metrics')!
    expect(panel.hidden).toBe(false)
    expect(document.activeElement).toBe(panel)
    expect(document.querySelector('#inspector-title')!.textContent).toBe('Metrics')
    expect(document.querySelector('#inspector-meta')!.textContent).toContain('2 metrics')
    expect(document.querySelector('#inspector-meta')!.textContent).not.toContain('insight')
    expect(document.querySelector('#inspector-meta')!.textContent).toContain('Happy path')
    expect(host.hidden).toBe(false)
    expect(host.querySelectorAll('dl.kv dt')).toHaveLength(2)
    expect(document.querySelector<HTMLElement>('#inspector-link')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('.json-row')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#inspector-copy')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#inspector-pre')!.hidden).toBe(true)

    pressEscape(controller)
    expect(panel.hidden).toBe(true)
    expect(closed).toEqual(['metrics'])

    controller.openMetrics('pay', { heading: 'Happy path', metrics })
    const message: MessageEvent = {
      kind: 'message',
      id: 'm7',
      from: 'api',
      to: 'payment-service',
      label: 'authorise',
      type: 'SYNCHRONOUS',
      data: { ok: true },
    }
    controller.openMessage('pay', message)
    expect(host.hidden).toBe(true)
    expect(host.childElementCount).toBe(0)
    expect(document.querySelector<HTMLElement>('.json-row')!.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('#inspector-copy')!.hidden).toBe(false)

    controller.openMetrics('pay', { heading: 'Happy path', metrics })
    document.querySelector<HTMLButtonElement>('#inspector-close')!.click()
    expect(closed).toEqual(['metrics', 'metrics'])
  })

  it('swapping to a component link clears the metrics view', () => {
    const controller = bindInspector(document, { loadPayload: async () => undefined, onClose: () => {} })
    controller.openMetrics('pay', { heading: 'Happy path', metrics })
    const link = { from: 'a', to: 'b', types: ['SYNCHRONOUS'], count: 1 }
    controller.openLink('pay', { nodes: [], edges: [link] }, 0, 'Happy path')
    const host = document.querySelector<HTMLElement>('#inspector-metrics')!
    expect(host.hidden).toBe(true)
    expect(host.childElementCount).toBe(0)
    expect(document.querySelector<HTMLElement>('#inspector-link')!.hidden).toBe(false)
  })
})
