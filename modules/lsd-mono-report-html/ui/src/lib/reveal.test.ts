// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealBelowTopbar, revealSideways } from './reveal'

function setup(panelTop: number, rowTop: number, preTop: number, preHeight: number) {
  document.body.innerHTML = '<aside><div class="json-row"></div><pre></pre></aside>'
  document.documentElement.style.setProperty('--topbar-h', '100px')
  const panel = document.querySelector('aside') as HTMLElement
  const row = document.querySelector('.json-row') as HTMLElement
  const pre = document.querySelector('pre') as HTMLElement
  const rect =
    (top: number, height = 20) =>
    () =>
      ({ top, height, bottom: top + height }) as DOMRect
  panel.getBoundingClientRect = rect(panelTop)
  row.getBoundingClientRect = rect(rowTop)
  pre.getBoundingClientRect = rect(preTop, preHeight)
  Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true })
  const scrollTo = vi.fn()
  window.scrollTo = scrollTo
  return { panel, pre, scrollTo }
}

describe('revealBelowTopbar', () => {
  afterEach(() => vi.restoreAllMocks())

  it('scrolls the panel head under the top bar when it fits with the start of the JSON', () => {
    const { panel, pre, scrollTo } = setup(600, 680, 720, 400)
    revealBelowTopbar(panel, pre)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 600 - 108, behavior: 'smooth' })
  })

  it("scrolls from the JSON's row when the head is too far above it", () => {
    const { panel, pre, scrollTo } = setup(100, 900, 940, 400)
    revealBelowTopbar(panel, pre)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 900 - 108, behavior: 'smooth' })
  })

  it('with no content (a component or metrics view) brings the heading under the top bar, or stays put', () => {
    const { panel, scrollTo } = setup(900, 0, 0, 0)
    revealBelowTopbar(panel)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000 + 900 - 108, behavior: 'smooth' })
    panel.getBoundingClientRect = () => ({ top: 300, height: 500, bottom: 800 }) as DOMRect
    revealBelowTopbar(panel)
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })

  it('jumps without animation under reduced motion, and stays put when the JSON is on screen', () => {
    const { panel, pre, scrollTo } = setup(600, 680, 720, 400)
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as unknown as typeof window.matchMedia
    revealBelowTopbar(panel, pre)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1492, behavior: 'auto' })
    pre.getBoundingClientRect = () => ({ top: 300, height: 400, bottom: 700 }) as DOMRect
    revealBelowTopbar(panel, pre)
    expect(scrollTo).toHaveBeenCalledTimes(1)
  })
})

describe('revealSideways (#116)', () => {
  function strip(left: number, right: number, scrollLeft = 0) {
    document.body.innerHTML = '<ul><li><button>chip</button></li></ul>'
    const scroller = document.querySelector('ul') as HTMLElement
    const chip = document.querySelector('button') as HTMLElement
    scroller.getBoundingClientRect = () => ({ left: 20, right: 373 }) as DOMRect
    chip.getBoundingClientRect = () => ({ left, right }) as DOMRect
    let x = scrollLeft
    Object.defineProperty(scroller, 'scrollLeft', { get: () => x, set: (v: number) => (x = v), configurable: true })
    return { scroller, chip, left: () => x }
  }

  it('scrolls a chip cut off at the far edge wholly into the row', () => {
    const { scroller, chip, left } = strip(299, 412)
    revealSideways(scroller, chip)
    expect(left()).toBe(39)
  })

  it('scrolls back for a chip cut off at the near edge', () => {
    const { scroller, chip, left } = strip(-10, 100, 39)
    revealSideways(scroller, chip)
    expect(left()).toBe(9)
  })

  it('leaves a chip already in the row, and lines up one wider than the row with its start', () => {
    const inside = strip(30, 200, 5)
    revealSideways(inside.scroller, inside.chip)
    expect(inside.left()).toBe(5)
    const wide = strip(50, 500)
    revealSideways(wide.scroller, wide.chip)
    expect(wide.left()).toBe(30)
  })
})
