// Find's matches inside the side panel's payload (#60): every match in the JSON is marked, the
// current one more strongly, with its own count and Previous / Next. Marks are built as text nodes
// and <mark> elements, never HTML, so the payload cannot inject markup, and the text (Copy, the
// print copy) stays exactly what it was.
import { MARK_LIMIT, foldCase, matchOffsets } from '../lib/payload-search'
import { scrollBehavior } from '../lib/media'

/** [text] in [pre] with each match of [query] (already folded) in a <mark>, up to [limit] of them. */
export function markText(
  pre: HTMLElement,
  text: string,
  query: string,
  limit = MARK_LIMIT,
): { marks: HTMLElement[]; total: number } {
  const { offsets, total } = matchOffsets(foldCase(text), query, limit)
  if (!offsets.length) {
    pre.textContent = text
    return { marks: [], total }
  }
  const doc = pre.ownerDocument
  const parts = doc.createDocumentFragment()
  const marks: HTMLElement[] = []
  let at = 0
  for (const start of offsets) {
    if (start > at) parts.append(text.slice(at, start))
    const mark = doc.createElement('mark')
    mark.className = 'json-hit'
    mark.textContent = text.slice(start, start + query.length)
    parts.append(mark)
    marks.push(mark)
    at = start + query.length
  }
  parts.append(text.slice(at))
  pre.replaceChildren(parts)
  return { marks, total }
}

/** Is [el] a box that scrolls on [axis] and has more to show than fits? */
function scrolls(el: HTMLElement, axis: 'x' | 'y'): boolean {
  const overflow = getComputedStyle(el)[axis === 'y' ? 'overflowY' : 'overflowX']
  if (overflow !== 'auto' && overflow !== 'scroll') return false
  return axis === 'y' ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth
}

/**
 * Bring [mark] into view: each box around it that scrolls (the wide JSON, the side panel) moves
 * just enough to centre it, then the page, if the mark is still off screen (the panel sits below
 * the report on a phone), so it shows below the sticky top bar. scrollIntoView would also move the
 * page under the sticky panel on a desktop.
 */
export function bringIntoView(mark: HTMLElement): void {
  const doc = mark.ownerDocument
  for (let el = mark.parentElement; el && el !== doc.body; el = el.parentElement) {
    const y = scrolls(el, 'y')
    const x = scrolls(el, 'x')
    if (!x && !y) continue
    const box = el.getBoundingClientRect()
    const at = mark.getBoundingClientRect()
    el.scrollTo({
      top: y ? el.scrollTop + at.top - box.top - (el.clientHeight - at.height) / 2 : el.scrollTop,
      left: x ? el.scrollLeft + at.left - box.left - el.clientWidth / 3 : el.scrollLeft,
    })
  }
  const win = doc.defaultView
  if (!win) return
  const bar = Number.parseFloat(getComputedStyle(doc.documentElement).getPropertyValue('--topbar-h')) || 0
  const at = mark.getBoundingClientRect()
  if (at.top >= bar && at.bottom <= win.innerHeight) return
  const top = win.scrollY + at.top - bar - (win.innerHeight - bar) / 3
  win.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() })
}

/** "2 of 5 in payload", saying when only the first matches are marked. */
export function marksLabel(current: number, marked: number, total: number): string {
  const base = `${current} of ${total} in payload`
  return marked < total ? `${base}, first ${marked} highlighted` : base
}

export interface JsonMarks {
  /** Show [text] in [pre] with [query] (folded) marked and the first match on screen. Whether anything matched. */
  show: (text: string, query: string) => boolean
  /** Hide the count and the step buttons (the JSON is hidden or another view opened). */
  hide: () => void
}

/** The panel's payload marks and their controls: a group with the count and Previous / Next. */
export function bindJsonMarks(parts: {
  pre: HTMLElement
  box: HTMLElement
  count: HTMLElement
  prev: HTMLButtonElement
  next: HTMLButtonElement
}): JsonMarks {
  const { pre, box, count, prev, next } = parts
  let marks: HTMLElement[] = []
  let total = 0
  let current = -1

  function select(index: number): void {
    marks[current]?.classList.remove('is-current')
    marks[current]?.removeAttribute('aria-current')
    current = index
    const mark = marks[current]
    if (!mark) return
    mark.classList.add('is-current')
    mark.setAttribute('aria-current', 'true')
    count.textContent = marksLabel(current + 1, marks.length, total)
    bringIntoView(mark)
  }

  function step(by: 1 | -1): void {
    if (!marks.length) return
    select((current + by + marks.length) % marks.length)
  }
  prev.addEventListener('click', () => step(-1))
  next.addEventListener('click', () => step(1))

  return {
    show(text, query) {
      ;({ marks, total } = markText(pre, text, query))
      current = -1
      box.hidden = marks.length === 0
      if (!marks.length) {
        count.textContent = ''
        return false
      }
      select(0)
      return true
    },
    hide() {
      marks = []
      total = 0
      current = -1
      box.hidden = true
      count.textContent = ''
    },
  }
}
