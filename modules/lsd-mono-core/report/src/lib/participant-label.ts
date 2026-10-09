/**
 * Participant names in the sequence header and on component diagram nodes.
 *
 * A name is measured with a fixed glyph table, so layout does not depend on
 * whether the web font has loaded and is the same in tests, on screen and in
 * print. A name up to [NAME_MAX_W] wide stays on one line and its shape grows
 * to fit. A longer one wraps onto a second line, and whatever still does not
 * fit ends in an ellipsis. The full name stays in the shape's title (hover)
 * and in the header's accessible name.
 */

/**
 * Advance widths for ASCII 32..126 at 11px, weight 650: the widest of Inter,
 * system-ui, Helvetica and Arial as measured in Chromium, rounded up. Using the
 * widest keeps a fallback font inside the shape too.
 */
const ASCII_W = [
  3.1, 3.9, 6.2, 7.4, 7.4, 11.3, 8.2, 3.8, 4.7, 4.7, 6.2, 7.5, 3.8, 5.4, 3.8, 4.3, 7.5, 6.2, 7.1, 7.4, 7.6, 7.3, 7.5,
  6.7, 7.6, 7.5, 3.8, 3.8, 7.5, 7.5, 7.5, 6.8, 11.2, 8.3, 8, 8.2, 8.3, 7.4, 6.8, 8.6, 8.6, 3.5, 6.6, 8, 6.8, 10.3, 8.5,
  8.7, 7.4, 8.7, 8, 7.5, 7.4, 8.4, 8.3, 11.5, 8.2, 8.1, 7.5, 4.7, 4.3, 4.7, 7.4, 6.9, 5.6, 6.5, 7.2, 6.5, 7.2, 6.7, 4.5,
  7.1, 7, 3.2, 3.2, 6.6, 3.3, 10.3, 6.9, 6.9, 7.2, 7.2, 4.8, 6.3, 4.6, 6.9, 6.6, 9.4, 6.4, 6.7, 6.3, 5.2, 4.1, 5.2, 7.5,
]
/** Accented Latin, Greek, Cyrillic and the like. */
const OTHER_W = 8
/** CJK, Hangul, emoji: about a full em. */
const WIDE_W = 11.5
export const ELLIPSIS = '…'

/** Widest a name line may be before it wraps, in header units (CSS px at zoom 1). */
export const NAME_MAX_W = 160
export const NAME_MAX_LINES = 2
export const NAME_LINE_H = 12

export interface FittedName {
  /** One or two lines as drawn. The last ends in an ellipsis when the name was cut. */
  lines: string[]
  /** Widest drawn line. */
  width: number
  truncated: boolean
}

function glyphWidth(code: number): number {
  if (code >= 32 && code <= 126) return ASCII_W[code - 32]
  if (code === 0x2026) return 9
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xff60) ||
    code >= 0x1f000
  ) {
    return WIDE_W
  }
  return OTHER_W
}

/** Drawn width of a participant name at 11px semibold. */
export function nameWidth(text: string): number {
  let w = 0
  for (const ch of text) w += glyphWidth(ch.codePointAt(0)!)
  return Math.round(w * 10) / 10
}

/** Places a line may end: after a space, hyphen, dot, slash, underscore or colon. */
function breaks(chars: string[]): number[] {
  const at: number[] = []
  chars.forEach((ch, i) => {
    if (i > 0 && i < chars.length - 1 && /[\s\-./_:]/.test(ch)) at.push(i + 1)
  })
  return at
}

/** Longest start of [chars] that fits, ending at a break when one fits, else mid-word. */
function firstLine(chars: string[], maxWidth: number): number {
  let best = 0
  for (const end of breaks(chars)) {
    if (nameWidth(chars.slice(0, end).join('').trimEnd()) <= maxWidth) best = end
    else break
  }
  if (best > 0) return best
  let end = 0
  while (end < chars.length && nameWidth(chars.slice(0, end + 1).join('')) <= maxWidth) end++
  return Math.max(end, 1)
}

function ellipsize(chars: string[], maxWidth: number): string {
  let end = chars.length
  while (end > 0 && nameWidth(chars.slice(0, end).join('').trimEnd() + ELLIPSIS) > maxWidth) end--
  return chars.slice(0, end).join('').trimEnd() + ELLIPSIS
}

export function fitName(name: string, maxWidth = NAME_MAX_W): FittedName {
  const text = name.replace(/\s+/g, ' ').trim()
  const whole = nameWidth(text)
  if (whole <= maxWidth) return { lines: [text], width: whole, truncated: false }
  const chars = Array.from(text)
  const cut = firstLine(chars, maxWidth)
  const first = chars.slice(0, cut).join('').trimEnd()
  const rest = Array.from(chars.slice(cut).join('').trimStart())
  const fits = nameWidth(rest.join('')) <= maxWidth
  const second = fits ? rest.join('') : ellipsize(rest, maxWidth)
  const lines = [first, second]
  return { lines, width: Math.max(...lines.map(nameWidth)), truncated: !fits }
}
