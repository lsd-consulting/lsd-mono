// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PRINT_BAND_OVERLAP_PX,
  PRINT_BAND_PX,
  PRINT_SLICE_PX,
  addPrintSlices,
  printBandCount,
  printSliceCount,
  removePrintSlices,
} from './print-slices'

describe('printSliceCount', () => {
  it('prints a drawing that fits a page as one, as before', () => {
    expect(printSliceCount(400)).toBe(1)
    expect(printSliceCount(PRINT_SLICE_PX)).toBe(1)
    expect(printSliceCount(Number.NaN)).toBe(1)
  })

  it('splits a wider one into enough strips to cover every lane', () => {
    expect(printSliceCount(2142)).toBe(3)
    expect(printSliceCount(15000)).toBe(15)
    for (const width of [1001, 2500, 7777])
      expect(printSliceCount(width) * PRINT_SLICE_PX).toBeGreaterThanOrEqual(width)
  })
})

describe('printBandCount', () => {
  it('keeps a drawing that fits a page in one band', () => {
    expect(printBandCount(300)).toBe(1)
    expect(printBandCount(PRINT_BAND_PX)).toBe(1)
  })

  it('cuts a taller one into overlapping bands that reach the bottom', () => {
    for (const height of [601, 1200, 5000]) {
      const bands = printBandCount(height)
      expect((bands - 1) * (PRINT_BAND_PX - PRINT_BAND_OVERLAP_PX) + PRINT_BAND_PX).toBeGreaterThanOrEqual(height)
      expect((bands - 2) * (PRINT_BAND_PX - PRINT_BAND_OVERLAP_PX) + PRINT_BAND_PX).toBeLessThan(height)
    }
  })
})

function diagram(width: number): HTMLElement {
  document.body.innerHTML = `<div class="seq-diagram"><div class="seq-stage">
    <svg class="seq-header-svg" viewBox="0 0 ${width} 80"></svg>
    <div class="seq-window"><svg class="seq-svg" viewBox="-20 0 ${width} 900"><text class="msg-label">x</text></svg></div>
  </div></div>`
  return document.querySelector<HTMLElement>('.seq-diagram')!
}

describe('addPrintSlices', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('puts full-size copies of the header and drawing in strips, each shifted by one strip', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    const root = diagram(2142)
    addPrintSlices(root)
    expect(root.getAttribute('data-print-sliced')).toBe('3')
    // 900 tall at 2142 wide: three strips (the last 142px), two bands of rows each, each page with
    // its strip's header, cropped by viewBox at full size.
    const pages = [...root.querySelectorAll<HTMLElement>('.print-slice')]
    expect(pages).toHaveLength(6)
    for (const page of pages) {
      expect(page.querySelectorAll('svg')).toHaveLength(2)
      expect(page.querySelector('svg')!.classList.contains('seq-header-svg')).toBe(true)
    }
    const step = PRINT_BAND_PX - PRINT_BAND_OVERLAP_PX
    const rows = pages.map((page) => page.querySelector<SVGSVGElement>('.seq-svg')!)
    expect(rows[0].getAttribute('viewBox')).toBe(`-20 0 ${PRINT_SLICE_PX} ${PRINT_BAND_PX}`)
    expect(rows[1].getAttribute('viewBox')).toBe(`-20 ${step} ${PRINT_SLICE_PX} ${900 - step}`)
    expect(rows[5].getAttribute('viewBox')).toBe(`${-20 + 2 * PRINT_SLICE_PX} ${step} 142 ${900 - step}`)
    expect(rows[5].style.width).toBe('142px')
    expect(pages[2].querySelector('.seq-header-svg')!.getAttribute('viewBox')).toBe(
      `${PRINT_SLICE_PX} 0 ${PRINT_SLICE_PX} 80`,
    )
    // Ahead of the stage, so the copies' marker ids resolve first.
    expect(root.firstElementChild!.classList.contains('print-slices')).toBe(true)
    removePrintSlices(root)
    expect(root.querySelector('.print-slices')).toBeNull()
    expect(root.hasAttribute('data-print-sliced')).toBe(false)
  })

  it('leaves a diagram that fits, or a browser without named pages, to the page-width fit', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    const narrow = diagram(600)
    addPrintSlices(narrow)
    expect(narrow.querySelector('.print-slices')).toBeNull()
    vi.stubGlobal('CSS', { supports: () => false })
    const wide = diagram(3000)
    addPrintSlices(wide)
    expect(wide.querySelector('.print-slices')).toBeNull()
  })
})
