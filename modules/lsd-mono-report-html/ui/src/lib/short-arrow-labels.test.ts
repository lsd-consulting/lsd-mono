import { describe, expect, it } from 'vitest'
import type { DiagramEvent, Participant } from '../types'
import { ACT_W, COL_GAP, LEFT_PAD, layoutRows } from './layout'
import { renderRowSvg } from './sequence-diagram'
import { DEFAULT_LABEL_MAX_CHARS } from '../ui/format'

const lane = (i: number) => LEFT_PAD + i * COL_GAP

const participants: Participant[] = [
  { id: 'customer', name: 'Customer', type: 'actor' },
  { id: 'orders', name: 'Order Service', type: 'participant' },
  { id: 'warehouse', name: 'Warehouse', type: 'participant' },
]
const base = LEFT_PAD * 2 + 2 * COL_GAP

function msg(id: string, from: string, to: string, label: string, type: string = 'synchronous'): DiagramEvent {
  return { kind: 'message', id, from, to, label, type }
}

describe('(d) short arrow labels stay off the lifeline and its bar', () => {
  function labelOf(svg: string): { x: number; anchor: string } {
    const m = /<text class="msg-label" x="([^"]+)" y="[^"]+" text-anchor="([^"]+)"/.exec(svg)!
    return { x: Number(m[1]), anchor: m[2] }
  }
  const row = (event: DiagramEvent) => layoutRows([event])[0]

  it('starts an outbound label past the bar edge and runs away from the lifeline', () => {
    const svg = renderRowSvg(
      row(msg('o', 'orders', '', 'SMTP relay', 'short_outbound')),
      base,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    const label = labelOf(svg)
    expect(label.anchor).toBe('start')
    expect(label.x).toBeGreaterThanOrEqual(lane(1) + ACT_W / 2)
  })

  it('ends an inbound label before the bar edge', () => {
    const svg = renderRowSvg(
      row(msg('i', '', 'orders', 'POST /webhooks/courier', 'short_inbound')),
      base,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    const label = labelOf(svg)
    expect(label.anchor).toBe('end')
    expect(label.x).toBeLessThanOrEqual(lane(1) - ACT_W / 2)
  })
})
