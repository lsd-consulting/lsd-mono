// Print: a diagram wider than a page prints at full size in strips of lanes instead of shrinking
// to the page width (14 participants came out at about 4pt). Each page holds one tile: a strip of
// lanes, cut into bands of rows, with that strip's participant header on top.

/**
 * Width one printed strip is counted at, in CSS pixels. The strips go on A4 landscape pages with
 * 10mm margins (`@page diagram` in print.css), 1047px across, so this leaves room.
 */
export const PRINT_SLICE_PX = 1000

/** Height of the rows on one page, header aside: A4 landscape with 10mm margins is about 718px tall. */
export const PRINT_BAND_PX = 600
/** Rows near a band's bottom edge print again at the top of the next, so no label is only half there. */
export const PRINT_BAND_OVERLAP_PX = 40

/** How many bands of rows a drawing `height` CSS pixels tall prints in. */
export function printBandCount(height: number, band = PRINT_BAND_PX, overlap = PRINT_BAND_OVERLAP_PX): number {
  if (!Number.isFinite(height) || height <= band) return 1
  return Math.ceil((height - band) / (band - overlap)) + 1
}

/** How many strips a drawing `width` CSS pixels wide prints in. One means it prints as before. */
export function printSliceCount(width: number, slice = PRINT_SLICE_PX): number {
  if (!Number.isFinite(width) || width <= slice) return 1
  return Math.ceil(width / slice)
}

function namedPagesSupported(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('page', 'diagram')
}

/** Strip copies of the header and the fully painted drawing, ahead of the stage. Needs every row painted. */
export function addPrintSlices(diagram: HTMLElement): void {
  removePrintSlices(diagram)
  // Without named pages the strips would land on portrait pages and could miss lanes: keep the fit.
  if (!namedPagesSupported()) return
  const header = diagram.querySelector<SVGSVGElement>('.seq-header-svg')
  const body = diagram.querySelector<SVGSVGElement>('.seq-window .seq-svg')
  const stage = diagram.querySelector('.seq-stage')
  if (!header || !body || !stage) return
  const width = Number(header.getAttribute('viewBox')?.split(' ')[2])
  const count = printSliceCount(width)
  if (count < 2) return
  const box = viewBox(body)
  if (!box) return
  // Body units per CSS pixel, with the drawing at the header's (full) width.
  const unit = box[2] / width
  const height = box[3] / unit
  const bands = printBandCount(height)
  const headBox = viewBox(header)
  const slices = document.createElement('div')
  slices.className = 'print-slices'
  slices.setAttribute('aria-hidden', 'true')
  for (let i = 0; i < count; i++) {
    // Each strip starts where the last ended; the last may be narrower.
    const left = i * PRINT_SLICE_PX
    const across = Math.min(PRINT_SLICE_PX, width - left)
    for (let j = 0; j < bands; j++) {
      const top = j * (PRINT_BAND_PX - PRINT_BAND_OVERLAP_PX)
      const down = Math.min(bands > 1 ? PRINT_BAND_PX : height, height - top)
      const slice = document.createElement('div')
      slice.className = 'print-slice'
      // Cropped by viewBox rather than shifted and clipped: Chromium's PDF output left shifted strips blank.
      if (headBox) {
        const hu = headBox[2] / width
        slice.append(
          crop(header, [headBox[0] + left * hu, headBox[1], across * hu, headBox[3]], across, headBox[3] / hu),
        )
      }
      slice.append(crop(body, [box[0] + left * unit, box[1] + top * unit, across * unit, down * unit], across, down))
      slices.append(slice)
    }
  }
  // First in the document, so the copies' marker and filter ids are the ones url(#…) finds.
  stage.before(slices)
  diagram.setAttribute('data-print-sliced', String(count))
}

function viewBox(svg: SVGSVGElement): [number, number, number, number] | undefined {
  const box = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (box?.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0) return undefined
  return box as [number, number, number, number]
}

/** A copy of `svg` showing only `box`, drawn at `w` x `h` CSS pixels: full size. */
function crop(svg: SVGSVGElement, box: [number, number, number, number], w: number, h: number): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('viewBox', box.map((n) => +n.toFixed(3)).join(' '))
  copy.setAttribute('preserveAspectRatio', 'xMinYMin meet')
  copy.style.width = `${Math.round(w)}px`
  copy.style.height = `${Math.round(h)}px`
  return copy
}

export function removePrintSlices(diagram: HTMLElement): void {
  diagram.querySelector('.print-slices')?.remove()
  diagram.removeAttribute('data-print-sliced')
}
