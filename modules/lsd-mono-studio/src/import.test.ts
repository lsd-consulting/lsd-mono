import { describe, expect, it } from 'vitest'
import { BUNDLED_SCHEMA, detectImport, findSchema, MAX_ERRORS, REPO_SCHEMA, reportErrors } from './import.ts'

describe('findSchema', () => {
  const missing = new URL('file:///nowhere/lsd-report.schema.json')

  it('uses the bundled copy first, then the repo schema', () => {
    expect(BUNDLED_SCHEMA.href).toMatch(/\/lsd-mono-studio\/schema\/lsd-report\.schema\.json$/)
    expect(REPO_SCHEMA.href).toMatch(/\/lsd-mono-report-schema\/lsd-report\.schema\.json$/)
    expect(findSchema([REPO_SCHEMA, missing])).toBe(REPO_SCHEMA)
    expect(findSchema([missing, REPO_SCHEMA])).toBe(REPO_SCHEMA)
  })

  it('says where it looked when there is none', () => {
    expect(() => findSchema([missing])).toThrow(/No report schema at \/nowhere\/lsd-report\.schema\.json/)
  })
})

describe('detectImport', () => {
  it('tells an LSD report from an OTLP export', () => {
    expect(detectImport(JSON.stringify({ schemaVersion: '1.0.0', scenarios: [] }))).toBe('lsd-report')
    expect(detectImport(JSON.stringify({ resourceSpans: [] }))).toBe('otlp')
    expect(detectImport(JSON.stringify({ title: 'pre-0.1', scenarios: [] }))).toBe('lsd-report')
  })

  it('rejects anything else', () => {
    expect(detectImport('not json')).toBe('unknown')
    expect(detectImport('[]')).toBe('unknown')
    expect(detectImport('null')).toBe('unknown')
    expect(detectImport('{}')).toBe('unknown')
  })
})

describe('reportErrors', () => {
  const report = {
    schemaVersion: '1.0.0',
    title: 't',
    generatedAt: '2026-01-01T00:00:00Z',
    generator: { name: 'g' },
    status: 'success',
  }

  it('accepts a 1.0 report and a newer minor', () => {
    expect(reportErrors(JSON.stringify(report))).toEqual([])
    expect(reportErrors(JSON.stringify({ ...report, schemaVersion: '1.4.0', extra: 1 }))).toEqual([])
  })

  it('lists what is wrong with a 1.x report', () => {
    expect(reportErrors(JSON.stringify({ ...report, status: 'SUCCESS', generatedAt: 'soon' }))).toEqual(
      expect.arrayContaining([
        '/status: must be equal to one of the allowed values',
        '/generatedAt: must match format "date-time"',
      ]),
    )
    expect(reportErrors(JSON.stringify({ schemaVersion: 'x' }))[0]).toMatch(/^\//)
  })

  it('caps the error list', () => {
    const scenarios = Array.from({ length: 200 }, () => ({}))
    expect(reportErrors(JSON.stringify({ ...report, scenarios }))).toHaveLength(MAX_ERRORS)
  })

  it('accepts 0.x reports with the basics the report UI upgrade needs', () => {
    expect(reportErrors(JSON.stringify({ schemaVersion: '0.3.0', title: 'x', scenarios: [{}] }))).toEqual([])
    expect(reportErrors(JSON.stringify({ scenarios: [] }))).toEqual([])
    expect(reportErrors(JSON.stringify({ schemaVersion: '0.1.0', title: 1, scenarios: [1] }))).toEqual([
      '/title: must be string',
      '/scenarios/0: must be object',
    ])
    expect(reportErrors(JSON.stringify({ scenarios: 'x' }))).toEqual(['/scenarios: must be array'])
  })

  it('refuses a newer major and anything not an object', () => {
    expect(reportErrors(JSON.stringify({ ...report, schemaVersion: '2.0.0' }))).toEqual([
      '/schemaVersion: 2.0.0 is a newer major than this server reads (1.x)',
    ])
    expect(reportErrors('[]')).toEqual(['/: must be a JSON object'])
  })
})
