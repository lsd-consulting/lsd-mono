import { describe, expect, it } from 'vitest'
import { formatGeneratedAt } from './format'

describe('formatGeneratedAt', () => {
  it('names the zone the time is shown in, winter or summer', () => {
    expect(formatGeneratedAt('2026-01-01T12:00:00Z', 'Europe/London')).toBe('1 Jan 2026, 12:00 GMT')
    expect(formatGeneratedAt('2026-07-01T12:00:00Z', 'Europe/London')).toBe('1 Jul 2026, 13:00 BST')
    expect(formatGeneratedAt('2026-01-01T12:00:00Z', 'UTC')).toBe('1 Jan 2026, 12:00 UTC')
  })

  it('shows the reader the time in their own zone', () => {
    expect(formatGeneratedAt('2026-01-01T12:00:00Z', 'America/New_York')).toBe('1 Jan 2026, 07:00 GMT-5')
  })

  it('keeps text that is not an instant, and survives an unknown zone', () => {
    expect(formatGeneratedAt('yesterday')).toBe('yesterday')
    expect(formatGeneratedAt('2026-01-01T12:00:00Z', 'Mars/Olympus')).toBe('2026-01-01T12:00:00Z')
  })
})
