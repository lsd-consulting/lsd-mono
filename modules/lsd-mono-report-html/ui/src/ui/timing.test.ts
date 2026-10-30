// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { Accuracy, MessageEvent, Scenario } from '../types'
import { conformanceReport } from '../lib/conformance.test-util'
import { hasTiming } from '../lib/timing'
import {
  axisHtml,
  niceStep,
  pairAccuracySectionHtml,
  pairAccuracySummary,
  tickLabel,
  timingPanelHtml,
  timingStripHtml,
} from './timing'
import { untimed } from '../lib/report-fixture.test-util'
const msg = (id: string, from: string, to: string, extra: Partial<MessageEvent> = {}): MessageEvent => ({
  kind: 'message',
  id,
  from,
  to,
  label: id,
  type: 'synchronous',
  ...extra,
})

const scenario = (events: MessageEvent[], extra: Partial<Scenario> = {}): Scenario => ({
  ...untimed(),
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
    msg('inner-reply', 'db', 'api', { type: 'synchronous_response', callId: 'c2', replyTo: 'inner' }),
    msg('event', 'api', 'kafka', { type: 'asynchronous', order: 'clock', parentId: 'outer' }),
    msg('outer-reply', 'api', 'web', { type: 'synchronous_response', callId: 'c1', replyTo: 'outer' }),
  ],
  { accuracy: 'traced', clockOrderedCount: 1, pairedRatio: 1 },
)

describe('timing view', () => {
  it('has no strip or lanes for a structure-only scenario', () => {
    const plain = scenario([msg('a', 'x', 'y')], { accuracy: 'structure_only' })
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
    const over = scenario(
      [
        msg('outer', 'web', 'api', { callId: 'c1', durationMs: 10 }),
        msg('inner', 'api', 'db', { callId: 'c2', durationMs: 25, parentId: 'outer' }),
        msg('inner-reply', 'db', 'api', { type: 'synchronous_response', replyTo: 'c2' }),
        msg('outer-reply', 'api', 'web', { type: 'synchronous_response', replyTo: 'c1' }),
      ],
      { accuracy: 'measured' },
    )
    const panel = timingPanelHtml(over)
    expect(panel).toContain('Calls inside took longer: 25 ms &gt; 10 ms')
    expect(panel).toContain('longer than this call&#39;s measured 10 ms')
    expect(panel).not.toContain('>!<')
    expect(panel.match(/class="warnx"/g)).toHaveLength(1)
  })

  it('lists accuracy by pair in its own section, not in the timing sections, when the report gives it', () => {
    expect(pairAccuracySectionHtml(nested)).toBe('')
    const paired: Scenario = {
      ...nested,
      pairAccuracy: [
        { from: 'web', to: 'api', accuracy: 'traced' },
        { from: 'api', to: 'kafka', accuracy: 'structure_only' },
      ],
    }
    expect(timingPanelHtml(paired)).not.toContain('Accuracy by pair')
    const section = pairAccuracySectionHtml(paired)
    expect(section).toContain('<h3>Accuracy by pair')
    expect(section).toContain('data-panel-section="pair-accuracy"')
    expect(section).toContain('web → api</span> <b class="acc-traced">traced</b>')
    expect(section).toContain('api → kafka</span> <b class="acc-structure_only">structure only</b>')
    // Two pairs: shown open, no summary to unfold.
    expect(section).not.toContain('<details')
  })

  it('folds more than six pairs under a summary of the count and each level, six or fewer stay open', () => {
    const levels: Accuracy[] = ['structure_only', 'traced', 'timestamped', 'traced', 'traced', 'timestamped', 'traced']
    const pairs = levels.map((accuracy, i) => ({ from: `p${i}`, to: `q${i}`, accuracy }))
    const seven = pairAccuracySectionHtml({ ...nested, pairAccuracy: pairs })
    expect(seven).toMatch(
      /<details class="pair-accuracy-more"><summary>7 pairs · 4 traced, 2 timestamped, 1 structure only<\/summary><ul class="pair-accuracy">/,
    )
    expect(seven).not.toContain('<details open')
    expect(seven.match(/<li>/g)).toHaveLength(7)
    const six = pairAccuracySectionHtml({ ...nested, pairAccuracy: pairs.slice(0, 6) })
    expect(six).not.toContain('<details')
    expect(six.match(/<li>/g)).toHaveLength(6)
  })

  it('summarises pairs best level first, singular for one, an unknown level as sent and last', () => {
    expect(pairAccuracySummary([{ accuracy: 'measured' }])).toBe('1 pair · 1 measured')
    expect(
      pairAccuracySummary([
        { accuracy: 'FUTURE' as Accuracy },
        { accuracy: 'structure_only' },
        { accuracy: 'measured' },
        { accuracy: 'traced' },
      ]),
    ).toBe('4 pairs · 1 traced, 1 measured, 1 structure only, 1 FUTURE')
  })

  it('has no Accuracy by pair section without timing', () => {
    expect(
      pairAccuracySectionHtml({
        ...scenario([msg('a', 'x', 'y')]),
        pairAccuracy: [{ from: 'a', to: 'b', accuracy: 'traced' }],
      }),
    ).toBe('')
  })

  it('uses H3 for the timing sections, under the panel title', () => {
    const panel = timingPanelHtml(nested)
    expect(panel).not.toContain('<h4')
    expect([...panel.matchAll(/<h3>([^<]+)/g)].map((m) => m[1].trim())).toEqual([
      'Time by participant',
      'Swim lanes',
      'Waterfall',
    ])
  })

  it('points only the Accuracy chip at Accuracy by pair, and only when there are pairs', () => {
    const sections = (html: string) => [...html.matchAll(/data-metrics-section="([^"]+)"/g)].map((m) => m[1])
    expect(sections(timingStripHtml(nested))).toEqual([])
    const strip = timingStripHtml({ ...nested, pairAccuracy: [{ from: 'web', to: 'api', accuracy: 'traced' }] })
    expect(sections(strip)).toEqual(['pair-accuracy'])
    expect(strip).toMatch(/data-metrics-section="pair-accuracy">\s*<span class="k">Accuracy<\/span>/)
  })

  it('labels warning pills from their kind, with the sentence on hover', () => {
    const panel = timingPanelHtml({
      ...nested,
      warnings: [{ kind: 'longer_than_parent', message: "'inner' took 30 ms: more than 'outer'" }],
    })
    expect(panel).toContain('>longer than parent</span>')
    expect(panel).toContain('title="longer than parent: &#39;inner&#39; took 30 ms: more than &#39;outer&#39;"')
  })

  it('escapes labels and participant names', () => {
    const html = timingPanelHtml(
      scenario([msg('<script>', '<img x>', 'y', { durationMs: 1 })], { accuracy: 'measured' }),
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
      msg('reply', 'api', 'web', { type: 'synchronous_response', replyTo: 'c1' }),
    ],
    { accuracy: 'measured', ...extra },
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
    const untimed = scenario([msg('call', 'web', 'api', { callId: 'c1' })], { accuracy: 'timestamped' })
    expect(chip(timingStripHtml(untimed), 'Slowest')).toBe('Slowest — nothing timed')
    expect(chip(timingStripHtml(untimed), 'Calls')).toBe('Calls 1 0 timed')
  })

  it('says how much was paired when nothing was clock-ordered', () => {
    expect(chip(timingStripHtml(timed({ pairedRatio: 0.666 })), 'Accuracy')).toBe(
      'Accuracy measured 67% exactly paired',
    )
    expect(chip(timingStripHtml(timed()), 'Accuracy')).toBe('Accuracy measured no calls')
  })

  it('shows an accuracy or warning kind from a newer core as it was sent', () => {
    const newer = timed({
      accuracy: 'SAMPLED' as Accuracy,
      warnings: [{ kind: 'CLOCK_JUMP', message: 'the clock went back' }],
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
  const report = conformanceReport('timing-tree')

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
