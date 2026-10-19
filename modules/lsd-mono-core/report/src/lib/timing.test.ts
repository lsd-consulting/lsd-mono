import { describe, expect, it } from 'vitest'
import type { MessageEvent, Scenario } from '../types'
import { formatMs, timeline } from './timing'

const msg = (id: string, from: string, to: string, extra: Partial<MessageEvent> = {}): MessageEvent => ({
  kind: 'message',
  id,
  from,
  to,
  label: id,
  type: 'SYNCHRONOUS',
  ...extra,
})

const scenario = (events: MessageEvent[], extra: Partial<Scenario> = {}): Scenario => ({
  id: 's1',
  title: 'T',
  status: 'success',
  description: '',
  facts: [],
  metrics: [],
  participants: [],
  events,
  ...extra,
})

const nested = scenario(
  [
    msg('outer', 'web', 'api', { callId: 'c1', durationMs: 50.5 }),
    msg('inner', 'api', 'db', { callId: 'c2', durationMs: 20, parentId: 'outer' }),
    msg('inner-reply', 'db', 'api', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c2', replyOf: 'inner' }),
    msg('event', 'api', 'kafka', { type: 'ASYNCHRONOUS', order: 'CLOCK', parentId: 'outer' }),
    msg('outer-reply', 'api', 'web', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c1', replyOf: 'outer' }),
  ],
  { accuracy: 'TRACED', clockOrdered: 1, pairingCoverage: 1 },
)

describe('timeline', () => {
  it('ignores a duration on a reply: the report writes it on the call', () => {
    const t = timeline(
      scenario([
        msg('call', 'a', 'b', { callId: 'c' }),
        msg('reply', 'b', 'a', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c', durationMs: 9 }),
      ]),
    )
    expect(t.rows.map((r) => [r.message.id, r.spanMs])).toEqual([['call', 0]])
  })

  it('nests calls, reads durations from the calls and splits self time', () => {
    const t = timeline(nested)
    expect(t.rows.map((r) => [r.message.id, r.depth, r.spanMs])).toEqual([
      ['outer', 0, 50.5],
      ['inner', 1, 20],
      ['event', 1, 0],
    ])
    expect(t.rows[0].selfMs).toBeCloseTo(30.5)
    expect(t.byParticipant).toEqual([
      { participant: 'api', ms: 30.5 },
      { participant: 'db', ms: 20 },
    ])
    expect(t.approximate).toBe(true)
    expect(t.timedCalls).toBe(2)
  })

  it('uses startedAt offsets in a single source', () => {
    const t = timeline(
      scenario(
        [
          msg('a', 'x', 'y', { startedAt: '2026-01-01T00:00:00Z', durationMs: 10 }),
          msg('b', 'x', 'z', { startedAt: '2026-01-01T00:00:00.100Z', durationMs: 5 }),
        ],
        { sources: ['local'] },
      ),
    )
    expect(t.rows.map((r) => r.startMs)).toEqual([0, 100])
    expect(t.totalMs).toBe(105)
    expect(t.approximate).toBe(false)
  })

  it('nests by parentId, not by position', () => {
    const t = timeline(
      scenario([
        msg('A', 'api', 'orders', { durationMs: 300 }),
        msg('B', 'api', 'stock', { durationMs: 50 }),
        msg('child', 'orders', 'db', { durationMs: 100, parentId: 'A' }),
      ]),
    )
    const row = (id: string) => t.rows.find((r) => r.message.id === id)!
    expect(row('B').depth).toBe(0)
    expect(row('child').depth).toBe(1)
    expect(row('A').selfMs).toBe(200)
  })

  it('formats fractional milliseconds', () => {
    expect(formatMs(2.25)).toBe('2.3 ms')
    expect(formatMs(652.25)).toBe('652 ms')
    expect(formatMs(12_500)).toBe('12.5 s')
  })
})
