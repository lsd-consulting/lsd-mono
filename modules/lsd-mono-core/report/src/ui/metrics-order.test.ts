// @vitest-environment happy-dom
// #95: the Timing and metrics panel reads timing first, then the metrics, then Accuracy by pair,
// and the Accuracy chip opens it at that last section.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Accuracy, MessageEvent, Scenario } from '../types'
import { bindInspector, inspectorMarkup } from './inspector'
import { pairAccuracySectionHtml, timingPanelHtml } from './timing'

const msg = (id: string, from: string, to: string, extra: Partial<MessageEvent> = {}): MessageEvent => ({
  kind: 'message',
  id,
  from,
  to,
  label: id,
  type: 'SYNCHRONOUS',
  ...extra,
})

function timed(pairs: number): Scenario {
  const levels: Accuracy[] = ['TRACED', 'TIMESTAMPED', 'STRUCTURE_ONLY']
  return {
    id: 'pay',
    title: 'Happy path',
    status: 'success',
    description: '',
    facts: [],
    metrics: [{ key: 'Messages', value: '2' }],
    participants: [],
    events: [
      msg('call', 'web', 'api', { callId: 'c1', durationMs: 12 }),
      msg('reply', 'api', 'web', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c1', replyOf: 'call' }),
    ],
    accuracy: 'TIMESTAMPED',
    pairAccuracy: Array.from({ length: pairs }, (_, i) => ({ from: `a${i}`, to: `b${i}`, accuracy: levels[i % 3] })),
  }
}

function open(scenario: Scenario, section?: string) {
  const controller = bindInspector(document, { loadPayload: async () => undefined, onClose: () => {} })
  controller.openMetrics(scenario.id, {
    heading: scenario.title,
    metrics: scenario.metrics,
    timingHtml: timingPanelHtml(scenario),
    pairAccuracyHtml: pairAccuracySectionHtml(scenario),
    section,
  })
  return document.querySelector<HTMLElement>('#inspector')!
}

const headings = () =>
  [...document.querySelectorAll('#inspector h2, #inspector h3, #inspector h4')].map(
    (h) => `${h.tagName} ${(h.firstChild?.textContent ?? '').trim()}`,
  )

describe('the Timing and metrics panel', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.body.innerHTML = `<div class="shell" id="shell">${inspectorMarkup()}</div>`
  })

  it('reads Time by participant, Swim lanes, Waterfall, Metrics, then Accuracy by pair, all H3 under the H2', () => {
    open(timed(3))
    expect(headings()).toEqual([
      'H2 Timing and metrics',
      'H3 Time by participant',
      'H3 Swim lanes',
      'H3 Waterfall',
      'H3 Metrics',
      'H3 Accuracy by pair',
    ])
    // Nothing after Accuracy by pair.
    const host = document.querySelector('#inspector-metrics')!
    expect(host.lastElementChild?.getAttribute('data-panel-section')).toBe('pair-accuracy')
    expect(host.querySelector('[data-panel-section="metrics"] dl.kv dt')?.textContent).toBe('Messages')
  })

  it('has no Accuracy by pair section without pair data', () => {
    open(timed(0))
    expect(headings().at(-1)).toBe('H3 Metrics')
  })

  it('keeps the plain Metrics view (no timing) as the list under the panel title', () => {
    const controller = bindInspector(document, { loadPayload: async () => undefined, onClose: () => {} })
    controller.openMetrics('pay', { heading: 'Pay', metrics: [{ key: 'Messages', value: '1' }] })
    expect(headings()).toEqual(['H2 Metrics'])
    expect(document.querySelectorAll('#inspector-metrics dl.kv dt')).toHaveLength(1)
  })

  it('folds more than six pairs, and the Accuracy chip opens the panel there, unfolded and scrolled to it', () => {
    const scrolls: ScrollToOptions[] = []
    const scrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (
      this: HTMLElement,
      options?: ScrollToOptions | number,
    ) {
      if (this.id === 'inspector' && typeof options === 'object') scrolls.push(options)
    })
    try {
      open(timed(20))
      const details = document.querySelector<HTMLDetailsElement>('#inspector details.pair-accuracy-more')!
      expect(details.open).toBe(false)
      expect(details.querySelector('summary')!.textContent).toBe('20 pairs · 7 traced, 7 timestamped, 6 structure only')
      expect(scrolls).toEqual([])

      const panel = open(timed(20), 'pair-accuracy')
      expect(document.querySelector<HTMLDetailsElement>('#inspector details.pair-accuracy-more')!.open).toBe(true)
      expect(scrolls).toHaveLength(1)
      // Focus is where opening the panel puts it (#86), not moved into the section.
      expect(document.activeElement).toBe(panel)
    } finally {
      scrollTo.mockRestore()
    }
  })

  it('opened without a section (Wall-clock, the Metrics button), starts at the top even if scrolled', () => {
    const panel = open(timed(20), 'pair-accuracy')
    panel.scrollTop = 600
    open(timed(20))
    expect(panel.scrollTop).toBe(0)
  })
})
