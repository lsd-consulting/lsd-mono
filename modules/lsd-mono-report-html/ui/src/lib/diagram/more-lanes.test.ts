// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { laneNamesWithin, lanesInViewText, showMoreLanes } from './more-lanes'

/** A scrollport [client] px wide over [scroll] px, with a lane box of 40 px centred at each x. */
function diagram(xs: number[], scroll = 1000, client = 300) {
  document.body.innerHTML = `<div class="seq-diagram">
    <span class="participant-filter-status" role="status"></span>
    <div class="seq-scroll">
      <div class="participant-heads">${xs.map((_, i) => `<div data-participant-head="p${i}" data-name="Lane ${i}"></div>`).join('')}</div>
      <svg class="seq-header-svg">${xs.map((_, i) => `<g class="participant-box" data-participant="p${i}"></g>`).join('')}</svg>
    </div>
  </div>`
  const port = document.querySelector<HTMLElement>('.seq-scroll')!
  Object.defineProperty(port, 'scrollWidth', { value: scroll })
  Object.defineProperty(port, 'clientWidth', { value: client })
  let left = 0
  Object.defineProperty(port, 'scrollLeft', {
    get: () => left,
    set: (v: number) => (left = v),
  })
  port.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: client, height: 100 })
  document.querySelectorAll<Element>('.participant-box').forEach((box, i) => {
    box.getBoundingClientRect = () => DOMRect.fromRect({ x: xs[i] - 20 - left, y: 0, width: 40, height: 40 })
  })
  return { port, status: document.querySelector('.participant-filter-status')! }
}

describe('lanesInViewText (#93)', () => {
  it('lists the lanes, and says when they are the last', () => {
    expect(lanesInViewText(['A'], false)).toBe('Lanes in view: A')
    expect(lanesInViewText(['A', 'B', 'C'], false)).toBe('Lanes in view: A, B and C')
    expect(lanesInViewText(['C', 'D'], true)).toBe('Last lanes in view: C and D')
    expect(lanesInViewText([], false)).toBe('Lanes in view')
  })
})

describe('laneNamesWithin', () => {
  it('names the lanes whose middle lies in the view at a given left, by their header names', () => {
    const { port } = diagram([50, 250, 450, 650, 850])
    expect(laneNamesWithin(port, 0)).toEqual(['Lane 0', 'Lane 1'])
    expect(laneNamesWithin(port, 400)).toEqual(['Lane 2', 'Lane 3'])
    // Measured in the drawing's own coordinates, wherever the scroll is now.
    port.scrollLeft = 200
    expect(laneNamesWithin(port, 400)).toEqual(['Lane 2', 'Lane 3'])
  })
})

describe('showMoreLanes', () => {
  it('scrolls about a screen right and says the lanes then in view, the last ones at the edge', () => {
    const { port, status } = diagram([50, 250, 450, 650, 850])
    showMoreLanes(port)
    expect(port.scrollLeft).toBeGreaterThan(200)
    expect(status.textContent).toMatch(/^Lanes in view: Lane 2/)
    showMoreLanes(port)
    showMoreLanes(port)
    expect(port.scrollLeft).toBe(700)
    expect(status.textContent).toBe('Last lanes in view: Lane 4')
  })
})
