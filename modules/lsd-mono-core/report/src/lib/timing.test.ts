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
    msg('outer', 'web', 'api', { callId: 'c1' }),
    msg('inner', 'api', 'db', { callId: 'c2' }),
    msg('inner-reply', 'db', 'api', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c2', durationMs: 20 }),
    msg('event', 'api', 'kafka', { type: 'ASYNCHRONOUS', order: 'CLOCK' }),
    msg('outer-reply', 'api', 'web', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c1', durationMs: 50.5 }),
  ],
  { accuracy: 'TRACED', clockOrdered: 1, pairingCoverage: 1 },
)

describe('timeline', () => {
  it('nests calls, moves reply durations onto calls and splits self time', () => {
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
          msg('a', 'x', 'y', { createdAt: '2026-01-01T00:00:00Z', durationMs: 10 }),
          msg('b', 'x', 'z', { createdAt: '2026-01-01T00:00:00.100Z', durationMs: 5 }),
        ],
        { sources: ['local'] },
      ),
    )
    expect(t.rows.map((r) => r.startMs)).toEqual([0, 100])
    expect(t.totalMs).toBe(105)
    expect(t.approximate).toBe(false)
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

  it('escapes labels and participant names', () => {
    const html = timingPanelHtml(
      scenario([msg('<script>', '<img x>', 'y', { durationMs: 1 })], { accuracy: 'MEASURED' }),
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img x>')
  })
})
