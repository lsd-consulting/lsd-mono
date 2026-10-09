import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('print css', () => {
  const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8')
  const screen = css.slice(0, css.indexOf('@media print'))
  const print = css.slice(css.indexOf('@media print'))
  const diagramCss = readFileSync(new URL('./diagram.css', import.meta.url), 'utf8')
  const diagramPrint = diagramCss.slice(diagramCss.indexOf('@media print'))

  it('hides the printed metrics on screen and shows them in print', () => {
    expect(screen).toMatch(/\.print-metrics\s*\{[^}]*display:\s*none/)
    expect(print).toMatch(/\.print-metrics\s*\{[^}]*display:\s*block/)
  })

  it('hides the printed panel copy on screen and shows it in print', () => {
    expect(screen).toMatch(/\.print-panel\s*\{[^}]*display:\s*none/)
    expect(print).toMatch(/\.print-panel\s*\{[^}]*display:\s*block/)
  })

  it('never prints the side panel itself, whatever it shows', () => {
    expect(print).toMatch(/#inspector\s*\{[^}]*display:\s*none\s*!important/)
    expect(print).not.toMatch(/#inspector\[data-view=/)
  })

  it('leaves the scenario list and the top bar off the page', () => {
    const hidden = print.match(/([^{}]*)\{\s*display:\s*none\s*!important;\s*\}/)![1]
    expect(hidden).toMatch(/\.topbar\b/)
    expect(hidden).toMatch(/\.sidebar\b/)
  })

  it('prints JSON wrapped and unclipped, and the component diagram whole at page width', () => {
    expect(print).toMatch(
      /\.print-message pre\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow:\s*visible[^}]*max-height:\s*none/,
    )
    expect(print).toMatch(/\.print-components\s*\{[^}]*break-inside:\s*avoid/)
    expect(print).toMatch(/\.print-components \.component-diagram\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/)
  })

  it('draws sequence diagrams across the page width', () => {
    expect(diagramPrint).toMatch(/\.seq-svg\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/)
    expect(diagramPrint).toMatch(/max-width:\s*var\(--seq-print-max/)
  })
})
