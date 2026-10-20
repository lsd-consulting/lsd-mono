import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TOUCH_HIT_CSS } from '../lib/diagram-a11y'
import { PILL_W, PILL_W_TOUCH } from '../lib/participant-filter'

// Sizes the TypeScript relies on and the CSS draws, kept in step (#98), as breakpoints.test.ts
// does for the media query widths.

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

/** The rules inside every `@media (pointer: coarse)` block of [css], braces balanced. */
function coarse(css: string): string {
  let out = ''
  for (
    let at = css.indexOf('@media (pointer: coarse)');
    at >= 0;
    at = css.indexOf('@media (pointer: coarse)', at + 1)
  ) {
    let depth = 0
    const open = css.indexOf('{', at)
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) {
        out += css.slice(open + 1, i)
        break
      }
    }
  }
  return out
}

/** The px value of [property] in the first rule whose selector list is exactly [selector]. */
function px(css: string, selector: string, property: string): number {
  const rule = new RegExp(`(?:^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  const body = rule.exec(css)?.[1]
  expect(body, `${selector} not found`).toBeDefined()
  const value = new RegExp(`(?:^|[;\\s])${property}:\\s*(\\d+)px`).exec(body!)?.[1]
  expect(value, `${selector} has no ${property} in px`).toBeDefined()
  return Number(value)
}

describe('sizes shared by the CSS and the TypeScript', () => {
  const filter = read('participant-filter.css')
  const zoom = read('zoom.css')

  it('draws the participant pill as wide as PILL_W, and PILL_W_TOUCH on a touch screen', () => {
    expect(px(filter, '.participant-head-actions', 'width')).toBe(PILL_W)
    expect(px(coarse(filter), '.participant-head-actions', 'width')).toBe(PILL_W_TOUCH)
  })

  it('makes the pill buttons TOUCH_HIT_CSS square on a touch screen, two of them filling the pill', () => {
    const touch = coarse(filter)
    expect(px(touch, '.participant-head-actions button', 'width')).toBe(TOUCH_HIT_CSS)
    expect(px(touch, '.participant-head-actions button', 'height')).toBe(TOUCH_HIT_CSS)
    // Two buttons, the 2px gap and 1px of padding and border on each side.
    expect(2 * TOUCH_HIT_CSS + 2 + 2 * 2).toBe(PILL_W_TOUCH)
  })

  it('makes the keyboard help close button 28px, and TOUCH_HIT_CSS square on a touch screen (#112)', () => {
    const css = read('inspector.css')
    expect(px(css, '.help-toast .help-close', 'width')).toBeGreaterThanOrEqual(24)
    expect(px(coarse(css), '.help-toast .help-close', 'width')).toBe(TOUCH_HIT_CSS)
    expect(px(coarse(css), '.help-toast .help-close', 'height')).toBe(TOUCH_HIT_CSS)
  })

  it('gives the zoom buttons a TOUCH_HIT_CSS target on a touch screen', () => {
    const touch = coarse(zoom)
    expect(px(touch, '.seq-toolbar .zoom-btn,\n  .seq-toolbar .zoom-readout', 'min-width')).toBe(TOUCH_HIT_CSS)
    expect(px(touch, '.seq-toolbar .zoom-btn,\n  .seq-toolbar .zoom-readout', 'min-height')).toBe(TOUCH_HIT_CSS)
  })
})
