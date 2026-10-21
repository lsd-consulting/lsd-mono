import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { conformanceText } from './conformance.test-util'
import { lazyPayloads, payloadTextScript } from './payloads'

// Written by the library (PayloadScriptGoldenTest): the browser must read what the core writes (#63).
const golden = conformanceText('payloads/payload-script.js')

/** Run a payload script as the page would, in a window of its own, and read every payload. */
function run(script: string): Record<string, unknown> {
  const window: { __LSD_PAYLOAD_TEXT__?: Record<string, string> } = {}
  runInNewContext(script, { window })
  const text = window.__LSD_PAYLOAD_TEXT__
  if (!text) throw new Error('the script assigned no __LSD_PAYLOAD_TEXT__')
  const payloads = lazyPayloads(text)
  return Object.fromEntries(Object.keys(payloads).map((key) => [key, payloads[key]]))
}

// What PayloadScriptGoldenTest captures, keyed as the core keys it (scenario 6, messages 1 to 5).
const captured = (lone: string, loneLow: string): Record<string, unknown> => ({
  '6/1': {
    html: '</script><!-- <b>a & b</b> -->',
    separators: 'line\u2028para\u2029end',
    quote: 'say "hi" \\ back\\slash\ttab\nnewline',
  },
  '6/2': {
    emoji: 'socks \u{1F9E6} and \u{1F44D}\u{1F3FD}',
    accents: 'Zoë, Ångström, naïve café',
    scripts: '東京 Москва القاهرة',
    lone,
    loneLow,
  },
  '6/3': 'just a body <with> & \u2028 in it',
  '6/4': '日本語 \u{1F9E6}',
  '6/5': {
    double: 0.1,
    whole: 2,
    tiny: 1e-7,
    huge: 1.5e300,
    negative: -42.25,
    decimal: 19.99,
    trailingZeros: 1.1,
    // As near as a double gets, which is what the page shows.
    wide: Number('12345678901234567890.123456789'),
    long: Number('9007199254740993'),
    nested: [1, 2.5, 3, { deep: [true, null] }],
  },
})

/** A lone surrogate reads as U+FFFD from either writer. */
const expected = captured('before \uFFFD after', 'x\uFFFDy')

describe('payload script golden (#63)', () => {
  it('reads every payload the Kotlin core wrote, with the values it captured', () => {
    expect(golden.startsWith('window.__LSD_PAYLOAD_TEXT__=')).toBe(true)
    expect(golden).not.toMatch(/[<>&\u2028\u2029]/)
    expect(run(golden)).toStrictEqual(expected)
  })

  it('reads the same values from the TypeScript writer, lone surrogates included', () => {
    const script = payloadTextScript(captured('before \uD800 after', 'x\uDC00y'))
    expect(script).not.toMatch(/[<>&\u2028\u2029]/)
    expect(run(script)).toStrictEqual(expected)
    expect(run(script)).toStrictEqual(run(golden))
  })
})
