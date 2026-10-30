import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_MAX_CHARS,
  formatGeneratedAt,
  histSegmentHtml,
  statusDotHtml,
  statusGlyph,
  topbarTitleText,
  truncateLabel,
} from './format'

describe('statusGlyph (#158)', () => {
  it('gives each status its own glyph, the error one matching the diagram mark', () => {
    expect(['success', 'warn', 'error'].map(statusGlyph)).toEqual(['✓', '!', '✕'])
  })
  it('marks skipped and aborted with glyphs common fonts cover, not a minus-like dash', () => {
    expect(['skipped', 'aborted'].map(statusGlyph)).toEqual(['»', '■'])
  })
})

describe('labelMaxChars (#111)', () => {
  it('defaults to what Kotlin writes when the report has no width', () => {
    const kotlin = readFileSync(
      new URL(
        '../../../../lsd-mono-jvm/src/main/kotlin/io/github/lsdconsulting/lsd/mono/jvm/ReportOptions.kt',
        import.meta.url,
      ),
      'utf8',
    )
    const width = /const val DEFAULT_LABEL_MAX_WIDTH = (\d+)/.exec(kotlin)?.[1]
    expect(width, 'DEFAULT_LABEL_MAX_WIDTH in ReportOptions.kt').toBeDefined()
    expect(DEFAULT_LABEL_MAX_CHARS).toBe(Number(width))
  })

  it('is where the diagram cuts a label, with an ellipsis inside the width', () => {
    expect(truncateLabel('  hello  ', 10)).toBe('hello')
    expect(truncateLabel('hello world', 6)).toBe('hel...')
    expect(truncateLabel('hello', 2)).toBe('he')
    expect(truncateLabel('hello', 0)).toBe('')
    expect(truncateLabel('x'.repeat(DEFAULT_LABEL_MAX_CHARS + 1), DEFAULT_LABEL_MAX_CHARS)).toHaveLength(
      DEFAULT_LABEL_MAX_CHARS,
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

describe('status glyphs in the sidebar', () => {
  it('puts the glyph in each dot, hidden from screen readers', () => {
    expect(statusDotHtml('success')).toBe('<span class="dot success" aria-hidden="true">✓</span>')
    expect(statusDotHtml('warn')).toContain('>!<')
    expect(statusDotHtml('error')).toContain('>✕<')
    expect(statusDotHtml('x"y')).toContain('class="dot x&quot;y"')
  })

  it('labels a status bar segment with its glyph and count, and leaves an empty one bare', () => {
    expect(histSegmentHtml('s', 'success', 3, 75)).toBe(
      '<span class="s" style="width:75%"><span class="hist-label">✓ 3</span></span>',
    )
    expect(histSegmentHtml('e', 'error', 0, 0)).toBe('<span class="e" style="width:0%"></span>')
  })
})

describe('topbarTitleText', () => {
  it("names the report, or all reports on an index, never the bare word 'Report'", () => {
    expect(topbarTitleText(false, ' Online shop ')).toBe('Online shop')
    expect(topbarTitleText(false, '')).toBe('Test report')
    expect(topbarTitleText(false)).toBe('Test report')
    expect(topbarTitleText(true, 'ignored')).toBe('All reports')
  })
})
