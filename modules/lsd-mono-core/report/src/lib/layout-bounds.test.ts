// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { DiagramEvent, Participant, Scenario } from '../types'
import { COL_GAP, HEADER_BLOCK_H, LEFT_PAD, NOTE_CARD_W } from './layout'
import { bindDiagramScroll, diagramPads, renderDiagramHtml, syncDiagramWindow } from './sequence-diagram'

const lane = (i: number) => LEFT_PAD + i * COL_GAP

const participants: Participant[] = [
  { id: 'customer', name: 'Customer', type: 'ACTOR' },
  { id: 'orders', name: 'Order Service', type: 'PARTICIPANT' },
  { id: 'warehouse', name: 'Warehouse', type: 'PARTICIPANT' },
]
const base = LEFT_PAD * 2 + 2 * COL_GAP

function msg(id: string, from: string, to: string, label: string, type: string = 'SYNCHRONOUS'): DiagramEvent {
  return { kind: 'message', id, from, to, label, type } as DiagramEvent
}

describe('diagram bounds include content on the outer lifelines', () => {
  it('adds no padding when everything sits between the lifelines', () => {
    expect(diagramPads([msg('m', 'customer', 'orders', 'POST /orders')], participants)).toEqual({ left: 0, right: 0 })
  })

  it('(a) makes room for a note left of the first lifeline', () => {
    const pads = diagramPads(
      [{ kind: 'note', id: 'n', text: 'Left of Customer', over: 'customer', placement: 'left' }],
      participants,
    )
    // Card left edge, shifted by the padding, is inside the drawing.
    expect(lane(0) - 90 - NOTE_CARD_W / 2 + pads.left).toBeGreaterThanOrEqual(0)
    expect(pads.right).toBe(0)
  })

  it('(b) makes room for a self-call label on the last lifeline', () => {
    const label = 'pick and pack'
    const pads = diagramPads([msg('s', 'warehouse', 'warehouse', label)], participants)
    // Label starts 56px right of the lifeline. Even a narrow 5px glyph estimate needs this much.
    expect(base + pads.right).toBeGreaterThanOrEqual(lane(2) + 56 + label.length * 5)
    expect(pads.left).toBe(0)
  })

  it('(b) makes room for a short inbound label on the first lifeline', () => {
    const pads = diagramPads([msg('i', '', 'customer', 'POST /webhooks/courier', 'SHORT_INBOUND')], participants)
    expect(pads.left).toBeGreaterThan(0)
  })

  it('ignores content on hidden lifelines', () => {
    const pads = diagramPads(
      [{ kind: 'note', id: 'n', text: 'Left of Customer', over: 'customer', placement: 'left' }],
      participants.slice(1),
    )
    expect(pads).toEqual({ left: 0, right: 0 })
  })
})

describe('padded diagram frame', () => {
  const scenario: Scenario = {
    id: 'sc-bounds',
    title: 'Bounds',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants,
    events: [
      msg('m1', 'customer', 'orders', 'POST /orders'),
      { kind: 'note', id: 'n', text: 'Left of Customer', over: 'customer', placement: 'left' },
      msg('s', 'warehouse', 'warehouse', 'pick and pack'),
    ],
  }

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

  it('widens the body and header and shifts their viewBox left by the padding', () => {
    const pads = diagramPads(scenario.events, participants)
    expect(pads.left).toBeGreaterThan(0)
    expect(pads.right).toBeGreaterThan(0)
    const total = base + pads.left + pads.right
    const body = document.querySelector('.seq-svg')!.getAttribute('viewBox')!.split(' ').map(Number)
    const head = document.querySelector('.seq-header-svg')!.getAttribute('viewBox')!.split(' ').map(Number)
    expect(body[0]).toBe(-pads.left)
    expect(body[2]).toBe(total)
    expect(head[0]).toBe(-pads.left)
    expect(head[2]).toBe(total)
    expect(document.querySelector<HTMLElement>('.seq-spacer')!.style.width).toBe(`${total}px`)
  })
})
