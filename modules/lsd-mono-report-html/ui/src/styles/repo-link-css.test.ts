import { readAppCss } from './read-css.test-util'
import { describe, expect, it } from 'vitest'

// The links to the lsd-mono repository (ui/repo-link.ts): a focus ring on screen, plain text on paper.
describe('repository link css', () => {
  const css = readAppCss()
  const screen = css.slice(0, css.indexOf('@media print'))
  const print = css.slice(css.indexOf('@media print'))

  it('shows a visible focus ring on screen', () => {
    expect(screen).toMatch(/\.repo-link:focus-visible\s*\{[^}]*outline:\s*2px solid/)
  })

  it('prints the version as plain text', () => {
    expect(print).toMatch(/\.version-link\s*\{[^}]*color:\s*inherit[^}]*text-decoration:\s*none/)
  })
})
