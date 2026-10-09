import { describe, expect, it } from 'vitest'
import type { DiagramEvent } from '../types'
import { SELF_RETURN_DY, layoutRows, noteCardMetrics } from './layout'

function msg(id: string, from: string, to: string, label: string, type: string = 'SYNCHRONOUS'): DiagramEvent {
  return { kind: 'message', id, from, to, label, type } as DiagramEvent
}

describe('(c) notes keep clear of the arrow above them', () => {
  it('pushes a tall note down so it does not cover the self-call loop before it', () => {
    const text =
      'Promotions stack in priority order. A long note like this one wraps onto several lines inside the card.'
    const rows = layoutRows([
      msg('self', 'orders', 'orders', 'apply promo'),
      { kind: 'activate', id: 'a', participantId: 'orders' },
      { kind: 'note', id: 'n', text, over: 'orders', placement: 'right' },
    ])
    const self = rows.find((r) => r.event.id === 'self')!
    const note = rows.find((r) => r.event.id === 'n')!
    const card = noteCardMetrics(text)
    expect(note.y - card.height / 2).toBeGreaterThanOrEqual(self.y + SELF_RETURN_DY + 4)
  })

  it('leaves a short note after a straight arrow where it was', () => {
    const rows = layoutRows([
      msg('m', 'customer', 'orders', 'POST'),
      { kind: 'note', id: 'n', text: 'short note', over: 'orders', placement: 'over' },
    ])
    expect(rows[1].y).toBe(rows[0].y + rows[0].height)
  })
})
