/**
 * The report UI's only escapers (#28). Every value interpolated into markup goes
 * through one of these, chosen by where it lands:
 *
 * - {@link escapeHtml}: element text, in HTML or inline SVG.
 * - {@link escapeAttr}: a quoted attribute value (`attr="…"` or `attr='…'`), including `style`.
 * - {@link jsonForScript}: a value written as JSON inside a `<script>` element or a `.js` file.
 * - {@link cssEscape}: a value inside a CSS selector passed to `querySelector`.
 *
 * The HTML escapers only escape markup. This markup is parsed in the page from
 * JavaScript strings, so control characters and lone surrogates cannot make it invalid,
 * and keeping them lets ids in attributes match the report data exactly. The Kotlin
 * writer, which writes UTF-8 files, also replaces those with U+FFFD
 * (`io.lsdconsulting.lsd.mono.core.html.Html`).
 */

const TEXT_UNSAFE = /[&<>]/g
const ATTR_UNSAFE = /[&<>"']/g

const ENTITY: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

type Printable = string | number | boolean | null | undefined

function text(value: Printable): string {
  return value == null ? '' : String(value)
}

function replace(match: string): string {
  return ENTITY[match]
}

/** For element text. Escapes `&`, `<` and `>`. Null and undefined become empty. */
export function escapeHtml(value: Printable): string {
  return text(value).replace(TEXT_UNSAFE, replace)
}

/** For a quoted attribute value. Escapes `&`, `<`, `>`, `"` and `'`. Null and undefined become empty. */
export function escapeAttr(value: Printable): string {
  return text(value).replace(ATTR_UNSAFE, replace)
}

/** A `\u` escape that JSON.stringify wrote for a lone surrogate (not one preceded by an escaped backslash). */
const LONE_SURROGATE_ESCAPE = /(?<=(?:^|[^\\])(?:\\\\)*)\\ud[89a-f][0-9a-f]{2}/g
const SCRIPT_UNSAFE = /[<>&\u2028\u2029]/g

/**
 * [value] as JSON that is safe inside `<script>` and in a classic `.js` file: `<`, `>`
 * and `&` are escaped so it cannot close the element or open a comment, U+2028 and
 * U+2029 so older parsers do not end the line, and lone surrogates become `\ufffd` so
 * the file is valid UTF-8. Matches Kotlin `jsonString`. `undefined` becomes `null`.
 */
export function jsonForScript(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null'
  return json
    .replace(SCRIPT_UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(LONE_SURROGATE_ESCAPE, '\\ufffd')
}

/** For a value inside a CSS selector, such as `[data-id="…"]` or `#card-…`. */
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1')
}
