// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { syncMoreCue } from './window'

/** A diagram whose scrollport is [client] px wide over a drawing [scroll] px wide, at [left]. */
function diagram(scroll: number, client: number, left = 0) {
  document.body.innerHTML = `<div class="seq-diagram">
    <div class="seq-toolbar"><button class="seq-more-lanes" data-more-lanes>More lanes →</button></div>
    <div class="seq-stage"><div class="seq-scroll" tabindex="-1"></div><button class="seq-edge-tab" data-more-lanes></button></div>
  </div>`
  const port = document.querySelector<HTMLElement>('.seq-scroll')!
  Object.defineProperty(port, 'scrollWidth', { value: scroll })
  Object.defineProperty(port, 'clientWidth', { value: client })
  Object.defineProperty(port, 'scrollLeft', { value: left, writable: true })
  return { port, stage: port.parentElement!, button: document.querySelector<HTMLElement>('.seq-more-lanes')! }
}

describe('syncMoreCue (#93)', () => {
  it('marks lanes to the right, and the stage while the drawing is wider at all', () => {
    const { port, stage } = diagram(900, 300)
    syncMoreCue(port)
    expect(port.hasAttribute('data-more-right')).toBe(true)
    expect(stage.hasAttribute('data-wide')).toBe(true)
  })

  it('keeps the stage marked wide at the right edge, where only the lanes cue goes', () => {
    const { port, stage } = diagram(900, 300, 600)
    syncMoreCue(port)
    expect(port.hasAttribute('data-more-right')).toBe(false)
    expect(stage.hasAttribute('data-wide')).toBe(true)
  })

  it('marks nothing for a drawing that fits', () => {
    const { port, stage } = diagram(302, 300)
    syncMoreCue(port)
    expect(port.hasAttribute('data-more-right')).toBe(false)
    expect(stage.hasAttribute('data-wide')).toBe(false)
  })

  it('hands focus from the toolbar button to the scrollport when the last lanes come into view', () => {
    const { port, button } = diagram(900, 300, 600)
    button.focus()
    syncMoreCue(port)
    expect(document.activeElement).toBe(port)
  })
})
