import { escapeAttr, escapeHtml } from '../lib/escape'
export function pretty(data: unknown): string {
  if (typeof data === 'string') {
    try {
      return JSON.stringify(JSON.parse(data), null, 2)
    } catch {
      return data
    }
  }
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

/**
 * When the report was written, in the reader's own time zone, named: "1 Jan 2026, 12:00 GMT".
 * [timeZone] is for tests; the page passes none. Not a valid instant: the text as written.
 */
export function formatGeneratedAt(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone,
    })
  } catch {
    // An unknown time zone name.
    return iso
  }
}

/** A status's glyph, so the chips differ without colour (#158): ✓, ! and ✕ (the error mark),
 * » for skipped (it was passed over) and ■ for aborted (a stop). Both are in common fonts, unlike ⊘. */
export function statusGlyph(s: string): string {
  return s === 'success'
    ? '✓'
    : s === 'warn'
      ? '!'
      : s === 'error'
        ? '✕'
        : s === 'skipped'
          ? '»'
          : s === 'aborted'
            ? '■'
            : '•'
}

/** A status dot in the sidebar, with its glyph inside so the status is not colour alone (#158). */
export function statusDotHtml(s: string): string {
  return `<span class="dot ${escapeAttr(s)}" aria-hidden="true">${escapeHtml(statusGlyph(s))}</span>`
}

/**
 * One segment of the status bar, labelled with its glyph and count like the chips (#158). The bar
 * stays aria-hidden: the chips and sidebar title already give the counts in words.
 */
export function histSegmentHtml(cls: string, status: string, count: number, width: number): string {
  const label = count ? `<span class="hist-label">${escapeHtml(statusGlyph(status))} ${count}</span>` : ''
  return `<span class="${escapeAttr(cls)}" style="width:${width}%">${label}</span>`
}

/**
 * The top bar's title, in place of the bare word "Report": the report's own title, or
 * "All reports" on an index page. The brand line under it still says Living Sequence Diagrams.
 */
export function topbarTitleText(isIndex: boolean, reportTitle?: string): string {
  if (isIndex) return 'All reports'
  return reportTitle?.trim() || 'Test report'
}

export function statusLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The default of `lsd.mono.label.maxWidth`: keep in step with Kotlin's
 * `ReportOptions.DEFAULT_LABEL_MAX_CHARS` (format.test.ts checks). Only the diagram cuts labels.
 */
export const DEFAULT_LABEL_MAX_CHARS = 200
const ELLIPSIS = '...'

export function truncateLabel(label: string, maxWidth: number): string {
  const trimmed = label.trim()
  if (trimmed.length <= maxWidth) return trimmed
  if (maxWidth <= 0) return ''
  if (ELLIPSIS.length >= maxWidth) return trimmed.slice(0, maxWidth)
  return trimmed.slice(0, maxWidth - ELLIPSIS.length) + ELLIPSIS
}
