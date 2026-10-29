import { describe, expect, it } from 'vitest'
import type { DiagramEvent, ReportJson, ScenarioJson } from '../types'
import { DEFAULT_OPTIONS, isKnownEvent, normaliseReport, normaliseScenario } from './report-normalise'
import { REPORT_SCHEMA_VERSION } from '../types'
import { sampleReport } from '../data/sample-report'

const call: DiagramEvent = { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'call', type: 'synchronous' }

function scenario(events: DiagramEvent[], timing: Partial<ScenarioJson> = {}): ScenarioJson {
  return {
    id: 's1',
    title: 'S',
    status: 'success',
    ...(events.length ? { events: events as ScenarioJson['events'] } : {}),
    ...timing,
  }
}

function report(scenarios: ScenarioJson[], extra: Partial<ReportJson> = {}): ReportJson {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    title: 'R',
    generatedAt: '2026-01-01T12:00:00Z',
    generator: { name: 'another', version: 'producer' },
    status: 'success',
    ...(scenarios.length ? { scenarios: scenarios as ReportJson['scenarios'] } : {}),
    ...extra,
  }
}

describe('normaliseReport', () => {
  it('fills in the options a report leaves out, keeping the ones it has', () => {
    expect(normaliseReport(report([])).options).toEqual(DEFAULT_OPTIONS)
    expect(DEFAULT_OPTIONS).toEqual({ metricsEnabled: true, labelMaxChars: 200, usagePing: false })
    const named = normaliseReport(report([], { options: { labelMaxChars: 40, source: 'junit' } }))
    expect(named.options).toEqual({ metricsEnabled: true, labelMaxChars: 40, usagePing: false, source: 'junit' })
  })

  it('gives one normalised report per report, and a normalised report is its own', () => {
    const written = report([scenario([call])])
    const loaded = normaliseReport(written)
    expect(normaliseReport(written)).toBe(loaded)
    expect(normaliseReport(loaded)).toBe(loaded)
    expect(written).not.toHaveProperty('options')
  })

  it('has normalised the built-in demo, which the page shows as it is', () => {
    expect(normaliseReport(sampleReport)).toBe(sampleReport)
    expect(sampleReport.options.labelMaxChars).toBe(200)
  })
})

describe('normaliseScenario', () => {
  it('keeps a timing summary the producer wrote', () => {
    const timing = {
      accuracy: 'traced',
      sources: ['a', 'b'],
      clockOrdering: 'all_sources',
      clockOrderedCount: 3,
    } as const
    expect(normaliseScenario(scenario([call], { ...timing, sources: [...timing.sources] }))).toMatchObject(timing)
  })

  it('without one, says what the events say: untimed messages on the one local clock', () => {
    expect(normaliseScenario(scenario([call]))).toMatchObject({
      accuracy: 'structure_only',
      sources: ['local'],
      clockOrdering: 'same_source',
      clockOrderedCount: 0,
    })
    expect(normaliseScenario(scenario([])).sources).toEqual([])
  })

  it('calls a scenario measured when a message has a duration or a start time', () => {
    expect(normaliseScenario(scenario([{ ...call, durationMs: 2 }])).accuracy).toBe('measured')
    expect(normaliseScenario(scenario([{ ...call, startedAt: '2026-01-01T12:00:00Z' }])).accuracy).toBe('measured')
  })

  it('drops events of a kind it does not know, and keeps the list when there are none', () => {
    const hologram = { kind: 'hologram', id: 'h1' } as unknown as DiagramEvent
    const events = [call]
    expect(normaliseScenario(scenario(events)).events).toBe(events)
    expect(normaliseScenario(scenario([hologram, call])).events).toEqual([call])
    expect(isKnownEvent({ kind: 'deactivate' })).toBe(true)
    expect(isKnownEvent({ kind: 'toString' })).toBe(false)
  })
})
