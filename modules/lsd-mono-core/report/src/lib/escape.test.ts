// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { cssEscape, escapeAttr, escapeHtml, jsonForScript } from './escape'

/** Every awkward input from #27/#28 in one string. */
const HOSTILE = `<b>&amp;"quoted" 'single'</script><!-- \u2028\u2029 \u0000\u0001\u001f \t\n\r \uD800 \uDC00 ok\uD83D\uDE00`

function parseText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

function parseAttr(html: string, quote: '"' | "'"): { count: number; value: string | null } {
  const div = document.createElement('div')
  div.innerHTML = `<span data-v=${quote}${html}${quote}></span>`
  const span = div.querySelector('span')
  return { count: div.children.length + (span ? span.attributes.length - 1 : 0), value: span?.getAttribute('data-v') ?? null }
}

describe('escapeHtml (element text)', () => {
  it('escapes &, < and >, and nothing else that is printable', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(`&lt;a href="x"&gt;Tom &amp; Jerry's&lt;/a&gt;`)
    expect(escapeHtml('</script><!--')).toBe('&lt;/script&gt;&lt;!--')
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })

  it('leaves U+2028/2029, control characters and lone surrogates to the DOM, which keeps them as text', () => {
    const awkward = 'a\u2028b\u2029c\t\n\r\f\u0001\u001f x\uD800y\uDC00z pair \uD83D\uDE00'
    expect(escapeHtml(awkward)).toBe(awkward)
    expect(escapeAttr(awkward)).toBe(awkward)
  })

  it('prints numbers and treats null and undefined as empty', () => {
    expect(escapeHtml(42)).toBe('42')
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('round-trips hostile text through the HTML parser as text only', () => {
    const div = document.createElement('div')
    div.innerHTML = `<p>${escapeHtml(HOSTILE)}</p>`
    expect(div.querySelectorAll('*').length).toBe(1)
    // Parsers may replace NUL and normalise carriage returns, so compare without them.
    // eslint-disable-next-line no-control-regex -- NUL is the point of this check
    const plain = (t: string) => t.replace(/[\u0000\uFFFD\r]/g, '')
    expect(plain(div.textContent ?? '')).toBe(plain(HOSTILE))
  })

  it('round-trips inside inline SVG text', () => {
    const svg = parseText(`<svg><text>${escapeHtml('<tspan>a & b</tspan>')}</text></svg>`)
    expect(svg).toBe('<tspan>a & b</tspan>')
  })
})

describe('escapeAttr (quoted attribute values)', () => {
  it('escapes &, <, >, double and single quotes', () => {
    expect(escapeAttr(`"x" onmouseover='y' <&>`)).toBe('&quot;x&quot; onmouseover=&#39;y&#39; &lt;&amp;&gt;')
  })

  it.each(['"', "'"] as const)('cannot break out of a %s-quoted attribute', (quote) => {
    const value = `${quote} data-pwned="1" x=${quote}><img src=x onerror=alert(1)>`
    const parsed = parseAttr(escapeAttr(value), quote)
    expect(parsed.count).toBe(1)
    expect(parsed.value).toBe(value)
  })

  it('round-trips hostile input as one attribute value', () => {
    const parsed = parseAttr(escapeAttr(HOSTILE), '"')
    expect(parsed.count).toBe(1)
    expect(parsed.value).toContain(`<b>&amp;"quoted" 'single'</script><!-- \u2028\u2029`)
  })
})

describe('jsonForScript (JSON inside <script>)', () => {
  it('escapes markup, separators and lone surrogates and stays valid JSON', () => {
    const value = { html: HOSTILE, [`key</script>`]: ['\uD800', '\\uD800 literal'] }
    const json = jsonForScript(value)
    expect(json).not.toMatch(/[<>&\u2028\u2029]/)
    // eslint-disable-next-line no-control-regex -- JSON must not carry raw control characters
    expect(json).not.toMatch(/[\u0000-\u001f]/)
    expect(json).toContain('\\u003c/script\\u003e\\u003c!--')
    expect(json).toContain('\\u2028\\u2029')
    expect(json).toContain('"\\ufffd"')
    // An escaped backslash followed by "uD800" is text, not a surrogate escape.
    expect(json).toContain('"\\\\uD800 literal"')
    expect(json).toContain('ok\uD83D\uDE00')
    const back = JSON.parse(json) as { html: string; 'key</script>': string[] }
    expect(back.html).toBe(HOSTILE.replace(/\uD800 /, '\uFFFD ').replace(/ \uDC00/, ' \uFFFD'))
    expect(back['key</script>']).toEqual(['\uFFFD', '\\uD800 literal'])
  })

  it('handles consecutive lone surrogates and undefined', () => {
    expect(jsonForScript('\uD800\uD800\uDC00')).toBe('"\\ufffd\uD800\uDC00"')
    expect(jsonForScript('\uDC00\uDC00')).toBe('"\\ufffd\\ufffd"')
    expect(jsonForScript(undefined)).toBe('null')
  })

  it('runs as a script without closing the element', () => {
    const div = document.createElement('div')
    div.innerHTML = `<script>window.__x=${jsonForScript({ a: HOSTILE })};</script><p>after</p>`
    expect(div.querySelectorAll('script').length).toBe(1)
    expect(div.querySelector('p')?.textContent).toBe('after')
    expect(div.querySelector('script')?.textContent).not.toContain('</script')
  })
})

describe('cssEscape (selectors)', () => {
  it('escapes quotes, brackets and spaces so a value cannot end the selector', () => {
    expect(cssEscape('card-a"]b c')).toBe('card-a\\"\\]b\\ c')
  })

  it('finds an element by an id that needs escaping', () => {
    const id = 'card-a.b:c'
    const div = document.createElement('div')
    div.innerHTML = `<i id="${escapeAttr(id)}" data-id="${escapeAttr(id)}"></i>`
    document.body.append(div)
    expect(document.querySelector(`#${cssEscape(id)}`)).not.toBeNull()
    expect(document.querySelector(`[data-id="${cssEscape(id)}"]`)).not.toBeNull()
    div.remove()
  })
})
