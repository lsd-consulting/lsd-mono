// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PRINT_BAND_MAX_PX,
  PRINT_BAND_OVERLAP_PX,
  PRINT_BAND_PX,
  PRINT_SLICE_PX,
  addPrintSlices,
  printBandCount,
  printSliceCount,
  printStrips,
  removePrintSlices,
  stripBands,
  stripMarks,
  widenForLabels,
  type PrintBox,
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
    // 900 tall at 2142 wide: three strips of 714px (no lanes to cut between, nothing laid out to
    // measure), two bands of rows each, each page with its strip's header, cropped by viewBox.
    const pages = [...root.querySelectorAll<HTMLElement>('.print-slice')]
    expect(pages).toHaveLength(6)
    for (const page of pages) {
      expect(page.querySelectorAll('svg')).toHaveLength(2)
      expect(page.querySelector('svg')!.classList.contains('seq-header-svg')).toBe(true)
    }
    const step = PRINT_BAND_PX - PRINT_BAND_OVERLAP_PX
    const rows = pages.map((page) => page.querySelector<SVGSVGElement>('.seq-svg')!)
    expect(rows[0].getAttribute('viewBox')).toBe(`-20 0 714 ${PRINT_BAND_PX}`)
    expect(rows[1].getAttribute('viewBox')).toBe(`-20 ${step} 714 ${900 - step}`)
    expect(rows[5].getAttribute('viewBox')).toBe(`${-20 + 2 * 714} ${step} 714 ${900 - step}`)
    expect(rows[5].style.width).toBe('714px')
    expect(pages[2].querySelector('.seq-header-svg')!.getAttribute('viewBox')).toBe(`714 0 714 80`)
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

/** Lane centres every `gap` px from `first`, `count` of them. */
const lanesAt = (count: number, first = 75, gap = 153) => Array.from({ length: count }, (_, i) => first + i * gap)

describe('printStrips (#117)', () => {
  it('cuts 2141px of 14 lanes into three balanced strips, halfway between lanes', () => {
    const lanes = lanesAt(14)
    const strips = printStrips(2141, lanes)
    expect(strips).toHaveLength(3)
    expect(strips[0].left).toBe(0)
    expect(strips.at(-1)!.right).toBe(2141)
    for (const [i, strip] of strips.entries()) {
      expect(strip.right - strip.left).toBeLessThanOrEqual(PRINT_SLICE_PX)
      expect(strip.right - strip.left).toBeGreaterThan(2141 / 3 - 153)
      if (i > 0) expect(strip.left).toBe(strips[i - 1].right)
      // The crop is the strip until labels widen it.
      expect([strip.cropLeft, strip.cropRight]).toEqual([strip.left, strip.right])
    }
    // Each cut is midway between two lifelines.
    for (const strip of strips.slice(1)) expect(Math.min(...lanes.map((x) => Math.abs(x - strip.left)))).toBe(76.5)
  })

  it('takes one more strip when the lanes do not allow even ones under the page width', () => {
    // Between-lane cuts at 850 and 1700 only: two strips would be 850 + 1050px.
    const strips = printStrips(1900, [100, 1600, 1800])
    expect(strips.map((s) => [s.left, s.right])).toEqual([
      [0, 850],
      [850, 1700],
      [1700, 1900],
    ])
    for (const strip of strips) expect(strip.right - strip.left).toBeLessThanOrEqual(PRINT_SLICE_PX)
  })

  it('cuts evenly with no lanes to go by, and keeps a drawing that fits whole', () => {
    expect(printStrips(2400, []).map((s) => [s.left, s.right])).toEqual([
      [0, 800],
      [800, 1600],
      [1600, 2400],
    ])
    expect(printStrips(900, lanesAt(5))).toEqual([{ left: 0, right: 900, cropLeft: 0, cropRight: 900 }])
  })
})

const box = (left: number, right: number, top = 100, bottom = top + 16): PrintBox => ({ left, right, top, bottom })

describe('widenForLabels (#117)', () => {
  it('widens a strip to hold whole a label whose middle is in it, within the drawing and the page', () => {
    const strips = printStrips(2141, lanesAt(14))
    const cut = strips[1].left
    // Middle just left of the cut: the first strip prints it whole; the second is not widened for it.
    widenForLabels(strips, [box(cut - 120, cut + 100), box(-30, 60)], 2141)
    expect(strips[0].cropRight).toBe(cut + 100)
    expect(strips[0].cropLeft).toBe(0)
    expect(strips[1].cropLeft).toBe(cut)
  })

  it('never crops wider than the page: the widening gives way', () => {
    const strips = printStrips(2141, lanesAt(14))
    const [first] = strips
    widenForLabels(strips, [box(first.right - 600, first.right + 400)], 2141)
    expect(first.cropRight - first.cropLeft).toBeLessThanOrEqual(PRINT_SLICE_PX)
    expect(first.cropLeft).toBe(0)
  })
})

describe('stripMarks and stripBands (#117)', () => {
  const strip = { left: 700, right: 1400, cropLeft: 700, cropRight: 1400 }

  it('counts marks that reach into the strip, and only the labels whose middle is in it', () => {
    const marks = [box(650, 710), box(1400, 1450), box(900, 910)]
    const labels = [box(600, 760), box(1300, 1600), box(1000, 1100)]
    expect(stripMarks(strip, marks, labels)).toEqual([box(650, 710), box(900, 910), box(1000, 1100)])
  })

  it('prints every band when there is nothing measured, as before', () => {
    expect(stripBands(1700).map((b) => b.top)).toEqual([0, 560, 1120])
    expect(stripBands(500)).toEqual([{ top: 0, down: 500 }])
  })

  it("covers only the rows of the strip's own content, as one band up to the page's room", () => {
    // Content from 1100 to 1700: one band from just above it, no pages of lifelines above.
    expect(stripBands(1800, [box(0, 1, 1100, 1110), box(0, 1, 1690, 1700)])).toEqual([{ top: 1084, down: 632 }])
    expect(632).toBeLessThanOrEqual(PRINT_BAND_MAX_PX)
  })

  it('leaves out a band in between that has nothing of its own', () => {
    const bands = stripBands(2400, [box(0, 1, 20, 40), box(0, 1, 2300, 2320)])
    expect(bands.length).toBe(2)
    expect(bands[0].top).toBe(4)
    expect(bands.at(-1)!.top + bands.at(-1)!.down).toBeGreaterThanOrEqual(2320)
  })

  it('keeps the first band of a strip with nothing at all, so its lanes still print', () => {
    expect(stripBands(1700, [])).toEqual([{ top: 0, down: PRINT_BAND_PX }])
  })
})

describe('addPrintSlices with the drawing laid out (#117)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('cuts between lanes and leaves out the tiles of lifelines alone', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    const lanes = lanesAt(14)
    document.body.innerHTML = `<div class="seq-diagram"><div class="seq-stage">
      <svg class="seq-header-svg" viewBox="0 0 2141 56"></svg>
      <div class="seq-window"><svg class="seq-svg" viewBox="0 0 2141 1700">
        ${lanes.map((x) => `<line class="lifeline-line" x1="${x}" x2="${x}"/>`).join('')}
        <g class="message"><line class="msg-path" data-r="75,40,228,40"/><text class="msg-label" data-r="100,24,200,36">a</text></g>
        <g class="message"><line class="msg-path" data-r="1912,1600,2065,1600"/><text class="msg-label" data-r="1940,1584,2040,1596">b</text></g>
      </svg></div>
    </div></div>`
    // Laid out at full size, 1px a px, the drawing's top left at 0,0.
    const rect = (l: number, t: number, r: number, b: number) =>
      ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t }) as DOMRect
    for (const el of document.querySelectorAll<SVGElement>('[data-r]')) {
      const [l, t, r, b] = el.dataset.r!.split(',').map(Number)
      el.getBoundingClientRect = () => rect(l, t, r, b)
    }
    document.querySelector<SVGSVGElement>('.seq-window .seq-svg')!.getBoundingClientRect = () => rect(0, 0, 2141, 1700)
    const root = document.querySelector<HTMLElement>('.seq-diagram')!
    addPrintSlices(root)
    const tiles = [...root.querySelectorAll('.print-slice .seq-svg')].map((svg) => svg.getAttribute('viewBox'))
    // Three strips: the first prints its top rows, the middle one (no content) its first band for
    // the header, the last only its bottom rows. Six tiles before.
    expect(tiles).toHaveLength(3)
    const top = (vb: string | null) => Number(vb!.split(' ')[1])
    expect(tiles[0]!.startsWith('0 ')).toBe(true)
    const first = root.querySelector<HTMLElement>('.print-slice')!
    expect(first.dataset.stripLeft).toBe('0.000')
    expect(Number(first.dataset.stripRight)).toBeGreaterThan(0)
    expect(top(tiles[0])).toBeLessThanOrEqual(24)
    expect(top(tiles[1])).toBe(0)
    expect(top(tiles[2])).toBeGreaterThan(1500)
    expect(root.getAttribute('data-print-sliced')).toBe('3')
  })
})
