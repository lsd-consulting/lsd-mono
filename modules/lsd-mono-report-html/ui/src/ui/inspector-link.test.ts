// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { componentGraph } from '../lib/component-graph'
import { bindInspector, inspectorMarkup } from './inspector'

const graph = componentGraph({
  participants: [
    { id: 'a', name: 'Shop', type: 'participant' },
    { id: 'b', name: 'Bank', type: 'participant' },
  ],
  events: [
    { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'charge', type: 'synchronous' },
    { kind: 'message', id: 'm2', from: 'a', to: 'b', label: 'charge', type: 'synchronous' },
    { kind: 'message', id: 'm3', from: 'a', to: 'b', label: '', type: 'asynchronous' },
  ],
})

describe('the link view (#105)', () => {
  beforeEach(() => {
    document.body.innerHTML = inspectorMarkup()
  })

  it('titles the panel from → to and lists the interactions, each with Show in sequence for its first message', () => {
    const closed: unknown[] = []
    const inspector = bindInspector(document, {
      loadPayload: async () => null,
      onClose: (...args) => closed.push(args),
    })
    inspector.openLink('pay', graph, 0, 'Pay')
    expect(document.querySelector('#inspector-title')!.textContent).toBe('Shop → Bank')
    expect(document.querySelector('#inspector-meta')!.textContent).toContain('3 interactions')
    const shows = [...document.querySelectorAll<HTMLButtonElement>('#inspector-link [data-show-in-sequence]')]
    expect(
      shows.map((b) => [b.dataset.showInSequence, b.dataset.scenarioId, b.textContent, b.getAttribute('aria-label')]),
    ).toEqual([
      ['m1', 'pay', 'Show in sequence', 'Show in sequence: charge'],
      ['m3', 'pay', 'Show in sequence', 'Show in sequence: (no label)'],
    ])
    expect(document.querySelector('#inspector-link')!.textContent).toContain('×2')
    expect(inspector.printView()).toMatchObject({ view: 'link', title: 'Shop → Bank' })
    inspector.close()
    expect(closed).toEqual([
      [
        { scenarioId: 'pay', kind: 'link', edge: 0 },
        { kind: 'button', scenarioId: 'pay', selector: '.comp-scroll .edge-group[data-edge-index="0"]', chip: null },
      ],
    ])
  })
})
