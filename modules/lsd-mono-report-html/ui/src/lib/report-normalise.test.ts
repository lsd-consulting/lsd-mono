import { describe, expect, it } from 'vitest'
import type { DiagramEvent, ReportJson, ScenarioJson } from '../types'
import { DEFAULT_OPTIONS, isKnownEvent, normaliseReport, normaliseScenario } from './report-normalise'
import { REPORT_SCHEMA_VERSION } from '../types'
import { sampleReport } from '../data/sample-report'

const call: DiagramEvent = { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'call', type: 'SYNCHRONOUS' }

function scenario(events: DiagramEvent[], timing: Partial<ScenarioJson> = {}): ScenarioJson {
  return {
    id: 's1',
    title: 'S',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants: [],
    events,
    ...timing,
  }
}

function report(scenarios: ScenarioJson[], extra: Partial<ReportJson> = {}): ReportJson {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    title: 'R',
    generatedAt: '2026-01-01T12:00:00Z',
    generator: 'another producer',
    status: 'success',
    scenarios,
    ...extra,
  }
}

describe('normaliseReport', () => {
  it('fills in the options a report leaves out, keeping the ones it has', () => {
    expect(normaliseReport(report([])).options).toEqual(DEFAULT_OPTIONS)
    expect(DEFAULT_OPTIONS).toEqual({ metricsEnabled: true, labelMaxWidth: 200, usagePing: false })
    const named = normaliseReport(report([], { options: { labelMaxWidth: 40, source: 'junit' } }))
    expect(named.options).toEqual({ metricsEnabled: true, labelMaxWidth: 40, usagePing: false, source: 'junit' })
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
    expect(sampleReport.options.labelMaxWidth).toBe(200)
  })
})

describe('normaliseScenario', () => {
  it('keeps a timing summary the producer wrote', () => {
    const timing = { accuracy: 'TRACED', sources: ['a', 'b'], clockOrdering: 'ALL_SOURCES', clockOrdered: 3 } as const
    expect(normaliseScenario(scenario([call], { ...timing, sources: [...timing.sources] }))).toMatchObject(timing)
  })

  it('without one, says what the events say: untimed messages on the one local clock', () => {
    expect(normaliseScenario(scenario([call]))).toMatchObject({
      accuracy: 'STRUCTURE_ONLY',
      sources: ['local'],
      clockOrdering: 'SAME_SOURCE',
      clockOrdered: 0,
    })
    expect(normaliseScenario(scenario([])).sources).toEqual([])
  })

  it('calls a scenario measured when a message has a duration or a start time', () => {
    expect(normaliseScenario(scenario([{ ...call, durationMs: 2 }])).accuracy).toBe('MEASURED')
    expect(normaliseScenario(scenario([{ ...call, startedAt: '2026-01-01T12:00:00Z' }])).accuracy).toBe('MEASURED')
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
