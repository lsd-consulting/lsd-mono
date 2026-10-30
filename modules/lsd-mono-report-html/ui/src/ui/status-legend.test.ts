import { describe, expect, it } from 'vitest'
import { STATUS_DEFINITIONS, statusLegendHtml, warnReason } from './status-legend'

const warn = (description: string, headline?: string, message = '') => ({
  status: 'warn' as const,
  description,
  error: headline ? { headline, message } : undefined,
})

describe('warnReason (#163)', () => {
  it('names what the integrations wrote for a Warn', () => {
    expect(warnReason(warn('Given a\nWhen b (undefined)', 'Undefined step'))).toBe('a step is undefined')
    expect(warnReason(warn('Given a (pending)', 'Pending'))).toBe('a step is pending')
    expect(warnReason(warn('Scenario was not completed before the report was written. Its events…'))).toMatch(
      /still running/,
    )
  })

  it('has none for an unknown cause or another status', () => {
    expect(warnReason(warn('Hand-written', 'AssertionFailedError'))).toBeNull()
    expect(warnReason({ status: 'error', description: 'Test disabled', error: undefined })).toBeNull()
    // Disabled and aborted tests have statuses of their own now (schema 1.0.0), so no Warn reason.
    expect(warnReason({ status: 'skipped', description: 'Test disabled: flaky', error: undefined })).toBeNull()
    expect(warnReason(warn('Test aborted', 'Test aborted', 'boom'))).toBeNull()
  })

  it('the legend holds every definition, each with the id the chips point at', () => {
    const html = statusLegendHtml()
    for (const s of ['success', 'warn', 'error', 'skipped', 'aborted'] as const) {
      expect(html).toContain(`id="status-def-${s}"`)
      expect(html).toContain(STATUS_DEFINITIONS[s])
    }
  })
})
