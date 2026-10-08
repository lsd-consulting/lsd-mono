import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const css = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const diagramCss = css('diagram.css')
const tokensCss = css('tokens.css')
const appCss = css('app.css')

/** Body of the first rule whose selector list contains `selector`. */
function block(css: string, selector: string): string {
  const at = css.indexOf(selector)
  expect(at, `${selector} not found`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

function token(body: string, name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim()
}

/**
 * Notes sit on top of lifelines, arrows and bars. A see-through card lets those
 * show through the text, which was hard to read on the dark theme.
 */
describe('note card colours', () => {
  it('fills the card from the opaque --note-bg token', () => {
    expect(token(block(diagramCss, '.note-card {'), 'fill')).toBe('var(--note-bg)')
  })

  for (const selector of ['[data-theme="dark"] {', '[data-theme="light"] {', '[data-theme="contrast"] {']) {
    it(`defines an opaque --note-bg for ${selector.slice(0, -2)}`, () => {
      const value = token(block(tokensCss, selector), '--note-bg')
      expect(value).toBeDefined()
      // No alpha channel and no transparent keyword. color-mix of two opaque
      // tokens stays opaque.
      expect(value).not.toMatch(/\/|transparent|rgba|hsla/)
    })
  }

  it('keeps notes opaque white in print', () => {
    expect(token(block(appCss, '[data-theme="contrast"] {\n    color-scheme: light;'), '--note-bg')).toBe('#fff')
  })
})
