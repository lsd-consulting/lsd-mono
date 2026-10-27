// The JSON Schema in modules/lsd-mono-report-schema: what it requires and allows, its version, and
// the report builders the checks share. conformance.test.ts checks the shared test reports against
// it; lsd-mono-jvm's ReportSchemaTest validates what the writer produces.
import { describe, expect, it } from 'vitest'
import { findReport } from '../../checks/find-fixture'
import { sectionsIndex, sectionsReport } from '../../checks/diagram-pages'
import { uxFixture } from '../../checks/ux-fixture'
import { wideReport } from '../../checks/wide-sample'
import { REPORT_SCHEMA_VERSION } from '../types'
import { conformanceText } from './conformance.test-util'
import { reportSchema, schemaErrors as errors } from './report-schema.test-util'

const example = (file: string) =>
  JSON.parse(conformanceText(`reports/${file}`)) as Record<string, unknown> & ExampleReport

interface ExampleReport {
  scenarios: ({ events: Record<string, unknown>[]; participants: Record<string, unknown>[] } & Record<
    string,
    unknown
  >)[]
  options: Record<string, unknown>
}

describe('the report schema', () => {
  it('validates the report builders the checks share', () => {
    const sections = sectionsReport(3)
    const built = { uxFixture, findReport, sections, wide: wideReport(5, 12, (_, id) => ({ id })) }
    for (const [name, report] of Object.entries(built)) expect(errors(report), name).toEqual([])
    expect(errors(sectionsIndex(sections).manifest, 'index')).toEqual([])
  })

  it('rejects a report without its schema version, and accepts fields a newer minor version adds', () => {
    const { schemaVersion, ...unversioned } = example('example-report.json')
    expect(schemaVersion).toBe(REPORT_SCHEMA_VERSION)
    expect(errors(unversioned)).toEqual([": must have required property 'schemaVersion'"])
    expect(errors({ ...unversioned, schemaVersion, fromANewerMinor: true })).toEqual([])
  })

  it('takes what a newer minor version or another producer may write', () => {
    const report = example('example-report.json')
    const [scenario] = report.scenarios
    const { accuracy, sources, clockOrdering, clockOrdered, ...untimed } = scenario
    expect([accuracy, sources, clockOrdering, clockOrdered]).not.toContain(undefined)
    const { options, ...optionless } = report
    expect(options).toBeDefined()
    const changed = {
      ...optionless,
      generatedAt: '2026-01-01T13:00:00.5+01:00',
      scenarios: [
        {
          ...untimed,
          participants: [{ ...scenario.participants[0], type: 'ROBOT' }],
          events: [
            { ...scenario.events.find((e) => e.kind === 'message'), type: 'BROADCAST' },
            { kind: 'hologram', id: 'h-1', fromANewerMinor: true },
          ],
        },
      ],
    }
    expect(errors(changed)).toEqual([])
  })

  it('rejects what no version allows', () => {
    const report = example('example-report.json')
    const [scenario] = report.scenarios
    const message = scenario.events.find((e) => e.kind === 'message')!
    const withScenario = (patch: Record<string, unknown>) => ({ ...report, scenarios: [{ ...scenario, ...patch }] })
    expect(errors({ ...report, generatedAt: 'yesterday' })).toEqual(['/generatedAt: must match format "date-time"'])
    expect(errors({ ...report, status: 'passed' })).not.toEqual([])
    expect(errors(withScenario({ id: '' }))).toEqual(['/scenarios/0/id: must NOT have fewer than 1 characters'])
    expect(errors(withScenario({ participants: [{ ...scenario.participants[0], name: '' }] }))).toContain(
      '/scenarios/0/participants/0/name: must NOT have fewer than 1 characters',
    )
    const fromless = Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'from'))
    expect(errors(withScenario({ events: [fromless] }))).not.toEqual([])
  })

  it('is the version the UI’s types were generated from', () => {
    expect(reportSchema.$id).toContain(`/schema/${REPORT_SCHEMA_VERSION}/`)
  })
})
