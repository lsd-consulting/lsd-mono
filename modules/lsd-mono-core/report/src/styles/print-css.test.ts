import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('print css', () => {
  const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8')
  const screen = css.slice(0, css.indexOf('@media print'))
  const print = css.slice(css.indexOf('@media print'))

  it('hides the printed metrics on screen and shows them in print', () => {
    expect(screen).toMatch(/\.print-metrics\s*\{[^}]*display:\s*none/)
    expect(print).toMatch(/\.print-metrics\s*\{[^}]*display:\s*block/)
  })

  it('leaves the side panel out of print only while it shows metrics', () => {
    expect(print).toMatch(/#inspector\[data-view="metrics"\]\s*\{[^}]*display:\s*none/)
    expect(print).not.toMatch(/#inspector\[data-view="(message|components|error)"\]/)
  })
})
