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

export function statusLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Matches Kotlin `String.abbreviate` / `lsd.mono.label.maxWidth` (default 200). */
export const DEFAULT_LABEL_MAX_WIDTH = 200
const ELLIPSIS = '...'

export function truncateLabel(label: string, maxWidth = DEFAULT_LABEL_MAX_WIDTH): string {
  const trimmed = label.trim()
  if (trimmed.length <= maxWidth) return trimmed
  if (maxWidth <= 0) return ''
  if (ELLIPSIS.length >= maxWidth) return trimmed.slice(0, maxWidth)
  return trimmed.slice(0, maxWidth - ELLIPSIS.length) + ELLIPSIS
}
