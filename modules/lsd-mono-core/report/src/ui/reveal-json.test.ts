// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { revealBelowTopbar } from './inspector'

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
