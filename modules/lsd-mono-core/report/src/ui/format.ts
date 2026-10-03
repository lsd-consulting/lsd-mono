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

export function formatGeneratedAt(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/London',
    }) + ' BST'
  } catch {
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
