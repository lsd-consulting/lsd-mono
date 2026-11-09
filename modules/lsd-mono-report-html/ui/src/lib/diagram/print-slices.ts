// Print: a diagram wider than a page prints at full size in strips of lanes instead of shrinking
// to the page width (14 participants came out at about 4pt). Each page holds one tile: a strip of
// lanes, cut into bands of rows, with that strip's participant header on top.
//
// #117: the strips are balanced and cut between lanes (2141px was 1000 + 1000 + one 141px lane over
// three pages); a strip widens to hold an arrow label whose middle is in it, so every label prints
// whole once; and each strip's bands of rows cover only the rows where it has something of its own
// (an arrow end, label, note or section title, not just lifelines and arrows passing through),
// leaving out a band in between that has none.

/**
 * Width one printed strip is counted at, in CSS pixels. The strips go on A4 landscape pages with
 * 10mm margins (`@page diagram` in print.css), 1047px across, so this leaves room.
 */
export const PRINT_SLICE_PX = 1000

/** Height of the rows on one page, header aside: A4 landscape with 10mm margins is about 718px tall. */
export const PRINT_BAND_PX = 600
/**
 * A strip's rows up to this tall print as one band rather than two, the second only a sliver: with
 * the 56px header that is still inside the 718px page.
 */
export const PRINT_BAND_MAX_PX = 640
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

/** A strip of lanes: where its lanes start and end, and the wider span it prints (for whole labels). */
export interface PrintStrip {
  left: number
  right: number
  cropLeft: number
  cropRight: number
}

/** A box in CSS pixels of the drawing at full size, from its top left. */
export interface PrintBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Strips for a drawing `width` px wide whose lanes are centred at `lanes`: as few as cover it at
 * `max` px or less each, of about equal width (width / count), cut halfway between two lanes. With
 * no lanes to go by, equal cuts. Each strip's crop is its own span for now (see widenForLabels).
 */
export function printStrips(width: number, lanes: number[], max = PRINT_SLICE_PX): PrintStrip[] {
  const strip = (left: number, right: number): PrintStrip => ({ left, right, cropLeft: left, cropRight: right })
  const count = printSliceCount(width, max)
  if (count < 2) return [strip(0, width)]
  const centres = [...lanes].filter(Number.isFinite).sort((a, b) => a - b)
  const gaps = centres.slice(1).map((x, i) => (centres[i] + x) / 2)
  for (let n = count; n <= count * 2 && gaps.length; n++) {
    const cuts: number[] = []
    for (let k = 1; k < n; k++) {
      const target = (k * width) / n
      const after = gaps.filter((g) => g > (cuts.at(-1) ?? 0))
      if (!after.length) break
      cuts.push(after.reduce((best, g) => (Math.abs(g - target) < Math.abs(best - target) ? g : best)))
    }
    const edges = [0, ...cuts, width]
    const spans = edges.slice(1).map((right, i) => [edges[i], right] as const)
    if (cuts.length === n - 1 && spans.every(([l, r]) => r - l <= max)) return spans.map(([l, r]) => strip(l, r))
  }
  const even = width / count
  return Array.from({ length: count }, (_, i) => strip(i * even, i === count - 1 ? width : (i + 1) * even))
}

/**
 * Widens each strip's crop to hold whole every label whose middle is in the strip, as far as the
 * drawing's edges and `max` px allow, so a label across a cut prints whole on one page.
 */
export function widenForLabels(strips: PrintStrip[], labels: PrintBox[], width: number, max = PRINT_SLICE_PX): void {
  for (const strip of strips) {
    let left = strip.cropLeft
    let right = strip.cropRight
    for (const label of labels) {
      const middle = (label.left + label.right) / 2
      if (middle < strip.left || middle >= strip.right) continue
      left = Math.min(left, Math.max(0, label.left))
      right = Math.max(right, Math.min(width, label.right))
    }
    // Over the page width: give back the widening, the left side first, as needed.
    const over = right - left - max
    if (over > 0) left = Math.min(strip.cropLeft, left + over)
    strip.cropLeft = left
    strip.cropRight = Math.min(right, left + max)
  }
}

/**
 * What strip `strip` holds of its own: every mark that reaches into its lanes, and the labels whose
 * middle is in them. A label that only pokes in from the next strip is that strip's, not this one's.
 */
export function stripMarks(strip: PrintStrip, marks: PrintBox[], labels: PrintBox[]): PrintBox[] {
  return [
    ...marks.filter((m) => m.right > strip.left && m.left < strip.right),
    ...labels.filter((l) => {
      const middle = (l.left + l.right) / 2
      return middle >= strip.left && middle < strip.right
    }),
  ]
}

/** Air kept above a strip's content, so its first and last rows are whole. */
const CONTENT_MARGIN_PX = 16

/**
 * The bands of rows a strip prints, for a drawing `height` px tall with content `marks` (its own,
 * from stripMarks).
 * Without marks (no layout to measure), every band of the drawing, as before #117. Otherwise the
 * bands cover only the rows from the strip's first content to its last, and any band among them
 * with nothing of its own is left out. A strip with no content at all keeps its first band, so its
 * lanes' header still prints.
 */
export function stripBands(height: number, marks?: PrintBox[]): { top: number; down: number }[] {
  const bandsOver = (lo: number, hi: number) => {
    const span = hi - lo
    const count = span <= PRINT_BAND_MAX_PX ? 1 : printBandCount(span)
    return Array.from({ length: count }, (_, j) => {
      const top = lo + j * (PRINT_BAND_PX - PRINT_BAND_OVERLAP_PX)
      return { top, down: Math.min(count > 1 ? PRINT_BAND_PX : span, hi - top) }
    })
  }
  if (!marks) return bandsOver(0, height)
  const own = marks.filter((m) => m.bottom > 0 && m.top < height)
  if (!own.length) return bandsOver(0, height).slice(0, 1)
  const lo = Math.max(0, Math.min(...own.map((m) => m.top)) - CONTENT_MARGIN_PX)
  const hi = Math.min(height, Math.max(...own.map((m) => m.bottom)) + CONTENT_MARGIN_PX)
  return bandsOver(lo, hi).filter((band) => own.some((m) => m.bottom > band.top && m.top < band.top + band.down))
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
  const headBox = viewBox(header)
  const lanes = [...body.querySelectorAll('.lifeline-line')].map(
    (line) => (Number(line.getAttribute('x1')) - box[0]) / unit,
  )
  const strips = printStrips(width, lanes)
  const found = printMarks(body, width, height)
  if (found) widenForLabels(strips, found.labels, width)
  const slices = document.createElement('div')
  slices.className = 'print-slices'
  slices.setAttribute('aria-hidden', 'true')
  for (const strip of strips) {
    const left = strip.cropLeft
    const across = strip.cropRight - strip.cropLeft
    const own = found ? stripMarks(strip, found.marks, found.labels) : undefined
    for (const { top, down } of stripBands(height, own)) {
      const slice = document.createElement('div')
      slice.className = 'print-slice'
      // Logical span in drawing units, so tests can check cuts independently of crop widening.
      slice.dataset.stripLeft = (strip.left * unit).toFixed(3)
      slice.dataset.stripRight = (strip.right * unit).toFixed(3)
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
  diagram.setAttribute('data-print-sliced', String(strips.length))
}

/**
 * Where the drawing's own content is, in px of the drawing at full size, from its layout on screen
 * (which takes in each row's transform): arrow ends, notes and section titles in `marks`, and
 * the arrow labels, which belong to the strip their middle is in (stripMarks). Undefined when nothing is laid out (no layout engine), so every tile prints.
 */
function printMarks(
  body: SVGSVGElement,
  width: number,
  height: number,
): { marks: PrintBox[]; labels: PrintBox[] } | undefined {
  const frame = body.getBoundingClientRect()
  if (!(frame.width > 0 && frame.height > 0)) return undefined
  const sx = width / frame.width
  const sy = height / frame.height
  const boxOf = (el: Element): PrintBox => {
    const r = el.getBoundingClientRect()
    return {
      left: (r.left - frame.left) * sx,
      top: (r.top - frame.top) * sy,
      right: (r.right - frame.left) * sx,
      bottom: (r.bottom - frame.top) * sy,
    }
  }
  const labels = [...body.querySelectorAll('.msg-label')].map(boxOf)
  const marks: PrintBox[] = []
  for (const el of body.querySelectorAll('.note-card, .section-title, .divider-label, .delay-label'))
    marks.push(boxOf(el))
  // An arrow's two ends, not the stretch between: an arrow passing through a strip is not its content.
  for (const path of body.querySelectorAll('.msg-path')) {
    const b = boxOf(path)
    const mid = (b.top + b.bottom) / 2
    marks.push({ left: b.left - 4, right: b.left + 4, top: mid - 4, bottom: mid + 4 })
    marks.push({ left: b.right - 4, right: b.right + 4, top: mid - 4, bottom: mid + 4 })
  }
  return { marks, labels }
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
