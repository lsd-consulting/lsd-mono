import { describe, expect, it } from 'vitest'
import { detectImport, otlpToReport } from './import.ts'

describe('detectImport', () => {
  it('tells an LSD report from an OTLP export', () => {
    expect(detectImport(JSON.stringify({ schemaVersion: '1.0.0', scenarios: [] }))).toBe('lsd-report')
    expect(detectImport(JSON.stringify({ resourceSpans: [] }))).toBe('otlp')
  })

  it('rejects anything else', () => {
    expect(detectImport('not json')).toBe('unknown')
    expect(detectImport('[]')).toBe('unknown')
    expect(detectImport('null')).toBe('unknown')
    expect(detectImport('{}')).toBe('unknown')
  })

  it('has no OTLP mapping yet', () => {
    expect(() => otlpToReport()).toThrow(/#186/)
  })
})
