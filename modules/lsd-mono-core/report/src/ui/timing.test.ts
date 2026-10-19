// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Accuracy, MessageEvent, Report, Scenario, WarningKind } from '../types'
import { hasTiming } from '../lib/timing'
import { axisHtml, niceStep, tickLabel, timingPanelHtml, timingStripHtml } from './timing'
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

  it('labels warning pills from their kind, with the sentence on hover', () => {
    const panel = timingPanelHtml({
      ...nested,
      warnings: [{ kind: 'LONGER_THAN_PARENT', message: "'inner' took 30 ms: more than 'outer'" }],
    })
    expect(panel).toContain('>longer than parent</span>')
    expect(panel).toContain('title="longer than parent: &#39;inner&#39; took 30 ms: more than &#39;outer&#39;"')
  })

  it('escapes labels and participant names', () => {
    const html = timingPanelHtml(
      scenario([msg('<script>', '<img x>', 'y', { durationMs: 1 })], { accuracy: 'MEASURED' }),
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img x>')
  })
})

/** The text of the chip whose key is `key`, as "key value hint". */
function chip(strip: string, key: string): string {
  const doc = new DOMParser().parseFromString(strip, 'text/html')
  const button = [...doc.querySelectorAll('.timing-chip')].find((b) => b.querySelector('.k')?.textContent === key)
  return [...button!.querySelectorAll('span')].map((span) => span.textContent).join(' ')
}

const timed = (extra: Partial<Scenario> = {}) =>
  scenario(
    [
      msg('call', 'web', 'api', { callId: 'c1', durationMs: 40 }),
      msg('reply', 'api', 'web', { type: 'SYNCHRONOUS_RESPONSE', replyTo: 'c1' }),
    ],
    { accuracy: 'MEASURED', ...extra },
  )

describe('timing strip', () => {
  it('counts sources in the plural, and one in the singular', () => {
    expect(chip(timingStripHtml(timed({ wallClockMs: 50 })), 'Wall-clock')).toBe('Wall-clock 50 ms 1 source')
    expect(chip(timingStripHtml(timed({ wallClockMs: 50, sources: ['a', 'b', 'c'] })), 'Wall-clock')).toBe(
      'Wall-clock 50 ms 3 sources',
    )
  })

  it('works the wall-clock out from the durations when it is missing or shorter than they are', () => {
    expect(chip(timingStripHtml(timed()), 'Wall-clock')).toBe('Wall-clock ≈40 ms from durations')
    expect(chip(timingStripHtml(timed({ wallClockMs: 10 })), 'Wall-clock')).toBe('Wall-clock ≈40 ms from durations')
  })

  it('names the slowest call below the top level, else the slowest top-level one, else nothing timed', () => {
    expect(chip(timingStripHtml(nested), 'Slowest')).toBe('Slowest 20 ms inner')
    expect(chip(timingStripHtml(timed()), 'Slowest')).toBe('Slowest 40 ms call')
    const untimed = scenario([msg('call', 'web', 'api', { callId: 'c1' })], { accuracy: 'TIMESTAMPED' })
    expect(chip(timingStripHtml(untimed), 'Slowest')).toBe('Slowest — nothing timed')
    expect(chip(timingStripHtml(untimed), 'Calls')).toBe('Calls 1 0 timed')
  })

  it('says how much was paired when nothing was clock-ordered', () => {
    expect(chip(timingStripHtml(timed({ pairingCoverage: 0.666 })), 'Accuracy')).toBe(
      'Accuracy measured 67% exactly paired',
    )
    expect(chip(timingStripHtml(timed()), 'Accuracy')).toBe('Accuracy measured no calls')
  })

  it('shows an accuracy or warning kind from a newer core as it was sent', () => {
    const newer = timed({
      accuracy: 'SAMPLED' as Accuracy,
      warnings: [{ kind: 'CLOCK_JUMP' as WarningKind, message: 'the clock went back' }],
    })
    expect(chip(timingStripHtml(newer), 'Accuracy')).toBe('Accuracy SAMPLED no calls')
    const panel = timingPanelHtml(newer)
    expect(panel).toContain('<span class="pill">SAMPLED</span>')
    expect(panel).toContain('title="CLOCK_JUMP: the clock went back">CLOCK_JUMP</span>')
    expect(panel).not.toContain('undefined')
  })
})

describe('waterfall axis', () => {
  const ticks = (total: number) =>
    [...new DOMParser().parseFromString(axisHtml(total), 'text/html').querySelectorAll('.ticks span')].map(
      (span) => span.textContent,
    )

  it('steps by 1, 2 or 5 times a power of ten, about a quarter of the total', () => {
    expect(niceStep(100)).toBe(50)
    expect(niceStep(40)).toBe(10)
    expect(niceStep(7)).toBe(2)
    expect(niceStep(0)).toBe(1)
    expect(niceStep(Number.NaN)).toBe(1)
  })

  it('labels a total under a millisecond in fractions, not as a row of zeros', () => {
    expect(ticks(0.8)).toEqual(['0.0', '0.2', '0.4', '0.6', '0.8'])
    expect(ticks(0.05)).toEqual(['0.00', '0.02', '0.04'])
  })

  it('labels milliseconds as whole numbers', () => {
    expect(ticks(40)).toEqual(['0', '10', '20', '30', '40'])
    expect(ticks(7)).toEqual(['0', '2', '4', '6'])
  })

  it('labels long totals in seconds', () => {
    expect(ticks(8000)).toEqual(['0 s', '2 s', '4 s', '6 s', '8 s'])
    expect(ticks(2500)).toEqual(['0 s', '1 s', '2 s'])
    expect(ticks(3_600_000)).toEqual(['0 s', '1000 s', '2000 s', '3000 s'])
    expect(tickLabel(1500, 500)).toBe('1500')
  })

  it('places the ticks along the track, the last at or before the end', () => {
    const html = axisHtml(0.3)
    const lefts = [...html.matchAll(/left:([\d.]+)%/g)].map((m) => Number(m[1]))
    expect(lefts[0]).toBe(0)
    expect(Math.max(...lefts)).toBeLessThanOrEqual(100)
    expect(lefts).toHaveLength(4)
  })
})

describe('timing view of the library golden', () => {
  // Written by the library (TimingTreeGoldenTest).
  const report = JSON.parse(
    readFileSync(join(process.cwd(), '../src/test/resources/golden/timing-tree.json'), 'utf8'),
  ) as Report

  it('renders every scenario without undefined or NaN, with a waterfall row per message row', () => {
    for (const s of report.scenarios.filter(hasTiming)) {
      const html = timingPanelHtml(s) + timingStripHtml(s)
      expect(html, s.title).not.toMatch(/undefined|NaN/)
      const doc = new DOMParser().parseFromString(timingPanelHtml(s), 'text/html')
      expect(doc.querySelectorAll('.waterfall > li').length, s.title).toBeGreaterThan(0)
      for (const button of doc.querySelectorAll('[data-show-message]'))
        expect(
          s.events.some((e) => e.id === button.getAttribute('data-show-message')),
          s.title,
        ).toBe(true)
    }
  })
})
