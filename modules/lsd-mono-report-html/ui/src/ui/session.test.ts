import { describe, expect, it } from 'vitest'
import { createSession } from './session'
import { sampleReport } from '../data/sample-report'

describe('createSession', () => {
  it('starts before boot with nothing rendered, loaded or open', () => {
    const session = createSession(sampleReport)
    expect(session.report).toBe(sampleReport)
    expect(session.booted).toBe(false)
    expect(session.writingHash).toBe(false)
    expect(session.switchingScenario).toBe(false)
    expect([session.reportId, session.loadingReportId, session.renderedId, session.panelScenarioId]).toEqual([
      null,
      null,
      null,
      null,
    ])
    expect(session.inspector).toBeNull()
    expect(session.invoker).toBeNull()
    expect(() => session.stopTopbarTracking()).not.toThrow()
  })

  it('gives each page its own state', () => {
    const a = createSession(sampleReport)
    const b = createSession(sampleReport)
    a.booted = true
    expect(b.booted).toBe(false)
  })
})
