import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LABEL_MAX_WIDTH, formatGeneratedAt, truncateLabel } from './format'

describe('labelMaxWidth (#111)', () => {
  it('defaults to what Kotlin writes when the report has no width', () => {
    const kotlin = readFileSync(
      new URL(
        '../../../../lsd-mono-core/src/main/kotlin/io/lsdconsulting/lsd/mono/core/ReportOptions.kt',
        import.meta.url,
      ),
      'utf8',
    )
    const width = /const val DEFAULT_LABEL_MAX_WIDTH = (\d+)/.exec(kotlin)?.[1]
    expect(width, 'DEFAULT_LABEL_MAX_WIDTH in ReportOptions.kt').toBeDefined()
    expect(DEFAULT_LABEL_MAX_WIDTH).toBe(Number(width))
  })

  it('is where the diagram cuts a label, with an ellipsis inside the width', () => {
    expect(truncateLabel('  hello  ', 10)).toBe('hello')
    expect(truncateLabel('hello world', 6)).toBe('hel...')
    expect(truncateLabel('hello', 2)).toBe('he')
    expect(truncateLabel('hello', 0)).toBe('')
    expect(truncateLabel('x'.repeat(DEFAULT_LABEL_MAX_WIDTH + 1), DEFAULT_LABEL_MAX_WIDTH)).toHaveLength(
      DEFAULT_LABEL_MAX_WIDTH,
    )
  })
})

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
