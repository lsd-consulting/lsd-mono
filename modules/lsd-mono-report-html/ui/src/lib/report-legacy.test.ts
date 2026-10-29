// Reports and indexes from before schema 1.0.0 open: the page upgrades them on read.
import { describe, expect, it } from 'vitest'
import type { ReportJson } from '../types'
import { conformanceText } from './conformance.test-util'
import { isLegacy, legacyGenerator, normaliseReport, upgradeLegacyReport } from './report-normalise'
import { normaliseIndex } from './report-index'
import type { IndexManifestJson } from './report-index'

const legacyReport = {
  schemaVersion: '0.1.0',
  title: 'Legacy',
  generatedAt: '2026-01-01T12:00:00Z',
  generator: 'lsd-mono-core 0.9.2',
  status: 'success',
  options: { metricsEnabled: true, labelMaxWidth: 120, usagePing: false, source: 'API' },
  scenarios: [
    {
      id: 's',
      title: 'Order',
      status: 'SUCCESS',
      description: '',
      facts: [],
      metrics: [],
      participants: [
        { id: 'a', name: 'Client', type: 'ACTOR', alias: 'The client', colour: '#123456' },
        { id: 'b', name: 'Orders', type: 'PARTICIPANT' },
      ],
      events: [
        { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'GET /order', type: 'SYNCHRONOUS', status: '' },
        {
          kind: 'message',
          id: 'm2',
          from: 'b',
          to: 'a',
          label: '200',
          type: 'SYNCHRONOUS_RESPONSE',
          replyOf: 'm1',
          replyTo: 'c1',
        },
        { kind: 'note', id: 'n1', text: 'n', over: 'a', placement: 'RIGHT_OF' },
      ],
      accuracy: 'MEASURED',
      sources: ['local'],
      clockOrdering: 'SAME_SOURCE',
      clockOrdered: 2,
      measuredCoverage: 0.5,
      pairingCoverage: 1,
    },
  ],
} as unknown as ReportJson

describe('a report from before 1.0.0', () => {
  it('is legacy when its major version is 0 or it names none', () => {
    expect(isLegacy({ schemaVersion: '0.1.0' })).toBe(true)
    expect(isLegacy({})).toBe(true)
    expect(isLegacy({ schemaVersion: '1.0.0' })).toBe(false)
    expect(isLegacy({ schemaVersion: '2.0.0' })).toBe(false)
  })

  it('splits a generator text into a name and a version', () => {
    expect(legacyGenerator('lsd-mono-jvm 0.9.2')).toEqual({ name: 'lsd-mono-jvm', version: '0.9.2' })
    expect(legacyGenerator('custom')).toEqual({ name: 'custom' })
    expect(legacyGenerator('lsd-mono-jvm 0.15.0')).toEqual({ name: 'lsd-mono-jvm', version: '0.15.0' })
    expect(legacyGenerator('lsd-mono-jvm v1.2')).toEqual({ name: 'lsd-mono-jvm', version: 'v1.2' })
    expect(legacyGenerator('lsd-mono-jvm 0.3.1-SNAPSHOT')).toEqual({ name: 'lsd-mono-jvm', version: '0.3.1-SNAPSHOT' })
    expect(legacyGenerator('lsd-mono-core (conformance)')).toEqual({ name: 'lsd-mono-core (conformance)' })
    expect(legacyGenerator('my adapter tool')).toEqual({ name: 'my adapter tool' })
    expect(legacyGenerator({ name: 'x', version: '1' })).toEqual({ name: 'x', version: '1' })
  })

  it('opens in 1.0.0’s shape: lower-case enums, the new names, and replyTo the call’s message id', () => {
    const report = normaliseReport(legacyReport)
    expect(report.generator).toEqual({ name: 'lsd-mono-core', version: '0.9.2' })
    expect(report.options).toMatchObject({ labelMaxChars: 120, source: 'api', usagePing: false })
    const [scenario] = report.scenarios
    expect(scenario.status).toBe('success')
    expect(scenario.participants[0]).toMatchObject({ type: 'actor', displayName: 'The client', color: '#123456' })
    expect(scenario).toMatchObject({
      accuracy: 'measured',
      clockOrdering: 'same_source',
      clockOrderedCount: 2,
      measuredRatio: 0.5,
      pairedRatio: 1,
    })
    const [call, reply, note] = scenario.events
    expect(call).toMatchObject({ type: 'synchronous' })
    expect(reply).toMatchObject({ type: 'synchronous_response', replyTo: 'm1', callId: 'c1' })
    expect(reply).not.toHaveProperty('replyOf')
    expect(note).toMatchObject({ placement: 'right_of' })
  })

  it('leaves the report it was given as it was', () => {
    const before = JSON.stringify(legacyReport)
    upgradeLegacyReport(legacyReport)
    normaliseReport(legacyReport)
    expect(JSON.stringify(legacyReport)).toBe(before)
  })

  it('opens the captured 0.1.0 report like the 1.0.0 one it became', () => {
    const legacy = normaliseReport(JSON.parse(conformanceText('invalid/legacy-report.json')) as ReportJson)
    const current = normaliseReport(JSON.parse(conformanceText('reports/multi-scenario-status.json')) as ReportJson)
    expect(legacy.scenarios.map((s) => [s.title, s.status, s.accuracy])).toEqual(
      current.scenarios.map((s) => [s.title, s.status, s.accuracy]),
    )
  })
})

describe('an index from before 1.0.0', () => {
  it('opens with message counts, five status counts and a generator object', () => {
    const index = normaliseIndex(JSON.parse(conformanceText('invalid/legacy-index.json')) as IndexManifestJson)
    expect(index.generator).toEqual({ name: 'lsd-mono-core (conformance)' })
    expect(index.title).toBe('LSD reports')
    const [report] = index.reports
    expect(report.counts).toEqual({ success: 1, warn: 1, error: 1, skipped: 0, aborted: 0 })
    expect(report.scenarios.map((s) => [s.status, s.messageCount])).toEqual([
      ['success', 0],
      ['warn', 0],
      ['error', 0],
    ])
  })
})
