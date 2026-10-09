// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Scenario } from '../types'
import { ACT_W, COL_GAP, HEADER_BLOCK_H, LEFT_PAD } from './layout'
import { bindDiagramScroll, renderDiagramHtml, syncDiagramWindow } from './sequence-diagram'

/**
 * Nested bars on a later lifeline (refs #2). The nested bar was drawn at the same x
 * as its parent and painted underneath it, so nesting was invisible.
 */
const scenario: Scenario = {
  id: 'sc-nested',
  title: 'Nested',
  status: 'success',
  description: '',
  facts: [],
  metrics: [],
  participants: [
    { id: 'web', name: 'Web', type: 'BOUNDARY' },
    { id: 'orders', name: 'Orders', type: 'PARTICIPANT' },
    { id: 'payments', name: 'Payments', type: 'PARTICIPANT' },
    { id: 'provider', name: 'Provider', type: 'PARTICIPANT' },
  ],
  events: [
    { kind: 'message', id: 'm1', from: 'orders', to: 'payments', label: 'authorise', type: 'SYNCHRONOUS' },
    { kind: 'activate', id: 'a1', participantId: 'payments' },
    { kind: 'message', id: 'm2', from: 'payments', to: 'payments', label: 'retry', type: 'SYNCHRONOUS' },
    { kind: 'activate', id: 'a2', participantId: 'payments', colour: '#f59e0b' },
    { kind: 'message', id: 'm3', from: 'payments', to: 'provider', label: 'charge', type: 'SYNCHRONOUS' },
    { kind: 'message', id: 'm4', from: 'provider', to: 'payments', label: 'ok', type: 'SYNCHRONOUS_RESPONSE' },
    { kind: 'deactivate', id: 'd2', participantId: 'payments' },
    { kind: 'message', id: 'm5', from: 'payments', to: 'orders', label: 'authorised', type: 'SYNCHRONOUS_RESPONSE' },
    { kind: 'deactivate', id: 'd1', participantId: 'payments' },
  ],
}

const lane = (i: number) => LEFT_PAD + i * COL_GAP

function bars(): { x: number; y: number; h: number }[] {
  return [...document.querySelectorAll('rect.activation')].map((r) => ({
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    h: Number(r.getAttribute('height')),
  }))
}

function arrowX(label: string): { x1: number; x2: number } {
  const g = [...document.querySelectorAll('g.message')].find((node) =>
    node.querySelector('.msg-label')?.textContent?.startsWith(label),
  )!
  const line = g.querySelector('line.msg-path')!
  return { x1: Number(line.getAttribute('x1')), x2: Number(line.getAttribute('x2')) }
}

describe('nested activation bars', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="root">${renderDiagramHtml(scenario)}</div>`
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 900 })
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 900 })
    const header = scroll.querySelector<HTMLElement>('.seq-sticky-header')!
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: HEADER_BLOCK_H })
    bindDiagramScroll(document.getElementById('root')!)
    syncDiagramWindow(scroll)
  })

  it('offsets a nested bar half a bar width right and paints it above its parent', () => {
    const drawn = bars()
    expect(drawn).toHaveLength(2)
    const [outer, inner] = drawn
    expect(outer.x).toBe(lane(2) - ACT_W / 2)
    expect(inner.x).toBe(lane(2) - ACT_W / 2 + ACT_W / 2)
    expect(inner.y).toBeGreaterThan(outer.y)
    expect(inner.y + inner.h).toBeLessThan(outer.y + outer.h)
  })

  it('attaches arrows to the innermost bar edge', () => {
    // Outgoing from the nested bar: starts at its right edge.
    expect(arrowX('charge').x1).toBe(lane(2) + ACT_W)
    // Response into the nested bar lands on its right edge too.
    expect(arrowX('ok').x2).toBe(lane(2) + ACT_W)
    // Back on the outer bar only: unchanged edge.
    expect(arrowX('authorised').x1).toBe(lane(2) - ACT_W / 2)
  })
})
