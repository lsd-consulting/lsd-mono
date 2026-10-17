import { describe, expect, it } from 'vitest'
import type { MessageEvent, Scenario } from '../types'
import { formatMs, hasTiming, timeline } from './timing'
import { timingPanelHtml, timingStripHtml } from '../ui/timing'

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

describe('timing view', () => {
  it('has no strip or lanes for a structure-only scenario', () => {
    const plain = scenario([msg('a', 'x', 'y')], { accuracy: 'STRUCTURE_ONLY' })
    expect(hasTiming(plain)).toBe(false)
    expect(timingStripHtml(plain)).toBe('')
    expect(timingPanelHtml(plain)).toContain('No timing captured')
  })

  it('shows the strip, swim lanes, waterfall and the clock badge', () => {
    const strip = timingStripHtml(nested)
    expect(strip).toContain('Accuracy')
    expect(strip).toContain('traced')
    expect(strip).toContain('1 clock-ordered')
    const panel = timingPanelHtml(nested)
    expect(panel).toContain('class="swim-lanes"')
    expect(panel.match(/class="lane"/g)).toHaveLength(2)
    expect(panel).toContain('tbadge clock')
    expect(panel).toContain('data-show-message="inner"')
  })

  it('says in words when the calls inside take longer than the call', () => {
    const over = scenario([
      msg('outer', 'web', 'api', { callId: 'c1', durationMs: 10 }),
      msg('inner', 'api', 'db', { callId: 'c2', durationMs: 25, parentId: 'outer' }),
      msg('inner-reply', 'db', 'api', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c2' }),
      msg('outer-reply', 'api', 'web', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c1' }),
    ])
    const panel = timingPanelHtml(over)
    expect(panel).toContain('Calls inside took longer: 25 ms &gt; 10 ms')
    expect(panel).toContain('longer than this call&#39;s measured 10 ms')
    expect(panel).not.toContain('>!<')
    expect(panel.match(/class="warnx"/g)).toHaveLength(1)
  })

  it('lists accuracy by pair when the report gives it', () => {
    expect(timingPanelHtml(nested)).not.toContain('Accuracy by pair')
    const panel = timingPanelHtml({
      ...nested,
      pairAccuracy: [
        { from: 'web', to: 'api', accuracy: 'TRACED' },
        { from: 'api', to: 'kafka', accuracy: 'STRUCTURE_ONLY' },
      ],
    })
    expect(panel).toContain('Accuracy by pair')
    expect(panel).toContain('web → api</span> <b class="acc-traced">traced</b>')
    expect(panel).toContain('api → kafka</span> <b class="acc-structure_only">structure only</b>')
  })

  it('escapes labels and participant names', () => {
    const html = timingPanelHtml(
      scenario([msg('<script>', '<img x>', 'y', { durationMs: 1 })], { accuracy: 'MEASURED' }),
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img x>')
  })
})
