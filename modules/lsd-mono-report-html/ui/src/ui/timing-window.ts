// The Timing view on a long timed scenario (#90). The waterfall draws only the rows around the
// scroll position, as the sequence diagram paints only its visible rows (#90b): the list keeps its
// full height (padding stands in for the rows not drawn), its rows keep their place in the Tab
// order, and a focused row stays drawn wherever the list is scrolled. The swim lanes paint their
// bars on a canvas per lane, with one button per lane on the bar under the pointer or the
// keyboard (#90c). Tab still steps through every bar and every row, in the same order as before.
import { RowHeights, laneBarAt, laneBarBox, visibleSpan, waterfallRange } from '../lib/timing-window'
import { timeline } from '../lib/timing'
import type { Scenario } from '../types'
import { laneBarHtml, laneTracks, waterfallRowHtml, type LaneTrack } from './timing'

/** Window the waterfall and paint the swim lanes of the Timing view in [host], where it drew them so. */
export function mountTimingWindow(host: HTMLElement, scenario: Scenario): () => void {
  const lanes = mountLaneCanvas(host, scenario)
  const waterfall = mountWaterfallWindow(host, scenario)
  return () => {
    lanes?.destroy()
    waterfall?.destroy()
  }
}

type Direction = 'forward' | 'back'

/** Which way Tab is moving focus right now (during the keydown's default action), or null. */
function watchTabDirection(doc: Document): { now: () => Direction | null; stop: () => void } {
  let tabbing: Direction | null = null
  const win = doc.defaultView
  const onKeydown = (ev: KeyboardEvent) => {
    if (ev.key !== 'Tab') return
    tabbing = ev.shiftKey ? 'back' : 'forward'
    win?.setTimeout(() => (tabbing = null), 0)
  }
  doc.addEventListener('keydown', onKeydown, true)
  return { now: () => tabbing, stop: () => doc.removeEventListener('keydown', onKeydown, true) }
}

export interface WaterfallWindow {
  /** Draw the rows for the current scroll position now (otherwise once a frame, on scroll or resize). */
  sync: () => void
  /** Draw row [i] and move focus to it; the browser scrolls it into view. */
  focusRow: (i: number) => void
  /** The rows drawn in the list's flow, [start, end). A focused row outside them is drawn too. */
  range: () => { start: number; end: number }
  /** Stop following scrolls and resizes. The rows drawn stay as they are. */
  destroy: () => void
}

/**
 * Window the waterfall in [host], when timingPanelHtml drew it windowed (data-waterfall-window).
 * Null for a short waterfall, which is drawn in full.
 */
export function mountWaterfallWindow(host: HTMLElement, scenario: Scenario): WaterfallWindow | null {
  const found = host.querySelector<HTMLOListElement>('ol.waterfall[data-waterfall-window]')
  if (!found) return null
  const list: HTMLOListElement = found
  const doc = list.ownerDocument
  const win = doc.defaultView
  const count = Number(list.dataset.rows) || 0
  const heights = new RowHeights(count)
  const drawn = new Map<number, HTMLLIElement>()
  for (const li of list.querySelectorAll<HTMLLIElement>(':scope > li[data-i]')) drawn.set(Number(li.dataset.i), li)
  let start = 0
  let end = drawn.size
  let estimated = false
  let frame = 0
  let width = -1
  const tab = watchTabDirection(doc)
  let destroyed = false
  const template = doc.createElement('template')

  const indexOf = (el: Element | null): number | null => {
    const li = el?.closest?.('li[data-i]')
    return li && li.parentElement === list ? Number((li as HTMLElement).dataset.i) : null
  }

  /** The row that has focus: it stays drawn when the window moves past it. */
  const focusedRow = (): number | null => indexOf(doc.activeElement)

  /** The window and the side panel (where it scrolls) clip the list. */
  function clips(): { top: number; bottom: number }[] {
    const out: { top: number; bottom: number }[] = [{ top: 0, bottom: win?.innerHeight ?? Infinity }]
    const panel = list.closest<HTMLElement>('.inspector')
    if (panel) {
      const r = panel.getBoundingClientRect()
      out.push({ top: r.top, bottom: r.bottom })
    }
    return out
  }

  /** Draw [from, to) in the flow, plus [extra] (focused rows) wherever they are, and nothing else. */
  function draw(from: number, to: number, extra: readonly (number | null)[]): void {
    const outside = [...new Set(extra)]
      .filter((i): i is number => i != null && i >= 0 && i < count && (i < from || i >= to))
      .sort((x, y) => x - y)
    for (const [i, li] of drawn)
      if ((i < from || i >= to) && !outside.includes(i)) {
        li.remove()
        drawn.delete(i)
      }
    const order: number[] = outside.filter((i) => i < from)
    for (let i = from; i < to; i++) order.push(i)
    for (const i of outside) if (i >= to) order.push(i)
    const html = order.filter((i) => !drawn.has(i)).map((i) => waterfallRowHtml(scenario, i))
    if (html.length) {
      template.innerHTML = html.join('')
      for (const li of [...template.content.children] as HTMLLIElement[]) drawn.set(Number(li.dataset.i), li)
    }
    // Rows already drawn are in order; only the new ones are placed, so a focused row never moves.
    let prev: HTMLLIElement | null = null
    for (const i of order) {
      const li = drawn.get(i)!
      const here: Element | null = prev ? prev.nextElementSibling : list.firstElementChild
      if (here !== li) {
        if (prev) prev.after(li)
        else list.prepend(li)
      }
      prev = li
    }
    start = from
    end = to
    place()
  }

  /** The padding that stands in for the rows not drawn, and rows kept outside the flow, at their place. */
  function place(): void {
    list.style.paddingTop = `${heights.top(start)}px`
    list.style.paddingBottom = `${Math.max(0, heights.total() - heights.top(end))}px`
    for (const [i, li] of drawn) {
      const pinned = i < start || i >= end
      li.toggleAttribute('data-pinned', pinned)
      li.style.top = pinned ? `${heights.top(i)}px` : ''
    }
  }

  /** Read the drawn rows' heights. True when the offsets changed. */
  function measure(): boolean {
    let changed = false
    const seen: number[] = []
    for (const [i, li] of drawn) {
      const h = li.getBoundingClientRect().height
      if (h > 0) seen.push(h)
      if (heights.set(i, h)) changed = true
    }
    // Rows not drawn yet are guessed from the ones that are, once per width.
    if (!estimated && seen.length) {
      seen.sort((a, b) => a - b)
      if (heights.setEstimate(seen[seen.length >> 1])) changed = true
      estimated = true
    }
    return changed
  }

  function sync(): void {
    if (destroyed) return
    if (!list.isConnected) {
      destroy()
      return
    }
    // Three passes at most: measuring the rows just drawn can move the rows that should be drawn.
    for (let pass = 0; pass < 3; pass++) {
      const span = visibleSpan(list.getBoundingClientRect(), clips())
      const next = waterfallRange({ offsets: heights.offsets(), top: span.top, bottom: span.bottom })
      const focused = focusedRow()
      if (pass > 0 && next.start === start && next.end === end) break
      draw(next.start, next.end, [focused])
      if (!measure()) break
      place()
    }
  }

  function schedule(): void {
    if (frame || destroyed || !win) return
    frame = win.requestAnimationFrame(() => {
      frame = 0
      sync()
    })
  }

  function focusRow(i: number): void {
    if (i < 0 || i >= count) return
    // The row focused now stays drawn until the new one has focus, so focus never drops to the page.
    draw(start, end, [focusedRow(), i])
    drawn.get(i)?.querySelector<HTMLElement>('button')?.focus()
    schedule()
  }

  const onScroll = (ev: Event) => {
    const target = ev.target
    if (target === doc || (target instanceof Node && target.contains(list))) schedule()
  }
  // Tab and Shift+Tab step through every row, drawn or not, as they did through the full list.
  const onKeydown = (ev: KeyboardEvent) => {
    if (ev.key !== 'Tab' || ev.altKey || ev.ctrlKey || ev.metaKey) return
    const i = indexOf(ev.target as Element | null)
    if (i == null) return
    const next = ev.shiftKey ? i - 1 : i + 1
    if (next < 0 || next >= count) return
    const li = drawn.get(i)!
    const sibling = ev.shiftKey ? li.previousElementSibling : li.nextElementSibling
    if (sibling && sibling === drawn.get(next)) return
    ev.preventDefault()
    focusRow(next)
  }
  // Tab into the list lands on its first row, Shift+Tab on its last, whichever rows are drawn.
  const onFocusin = (ev: FocusEvent) => {
    const i = indexOf(ev.target as Element | null)
    const from = ev.relatedTarget
    const tabbing = tab.now()
    if (i == null || !tabbing || (from instanceof Node && list.contains(from))) return
    const want = tabbing === 'forward' ? 0 : count - 1
    if (i !== want) focusRow(want)
  }
  const resize =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(([entry]) => {
          const w = Math.round(entry.contentRect.width)
          if (w === width) return
          // A new width can wrap rows differently: measure them again.
          if (width >= 0) {
            heights.reset()
            estimated = false
          }
          width = w
          schedule()
        })

  doc.addEventListener('scroll', onScroll, { capture: true, passive: true })
  win?.addEventListener('resize', schedule)
  list.addEventListener('keydown', onKeydown)
  list.addEventListener('focusin', onFocusin)
  resize?.observe(list)

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    if (frame && win) win.cancelAnimationFrame(frame)
    frame = 0
    doc.removeEventListener('scroll', onScroll, { capture: true })
    tab.stop()
    win?.removeEventListener('resize', schedule)
    list.removeEventListener('keydown', onKeydown)
    list.removeEventListener('focusin', onFocusin)
    resize?.disconnect()
  }

  sync()
  return { sync, focusRow, range: () => ({ start, end }), destroy }
}

/** What the canvases paint bars with: timing.css .lane-bar's opacity and border-radius. */
const LANE_BAR_OPACITY = 0.85
const LANE_BAR_RADIUS_PX = 3

export interface LaneCanvas {
  /** Paint every lane again (its width, the theme or the screen's pixel density changed). */
  paint: () => void
  /** Put lane [lane]'s button on its bar [bar] and focus it. */
  focusBar: (lane: number, bar: number) => void
  /** Stop following the pointer, keys, theme and size. */
  destroy: () => void
}

/**
 * Paint the swim lanes in [host] on their canvases, when timingPanelHtml drew them so
 * (data-lane-canvas). Null for few bars, each its own button.
 */
export function mountLaneCanvas(host: HTMLElement, scenario: Scenario): LaneCanvas | null {
  const found = host.querySelector<HTMLOListElement>('ol.swim-lanes[data-lane-canvas]')
  if (!found) return null
  const list: HTMLOListElement = found
  const doc = list.ownerDocument
  const win = doc.defaultView
  const t = timeline(scenario)
  const total = t.totalMs || 1
  const lanes = laneTracks(t)
  const tracks = [...list.querySelectorAll<HTMLElement>('.lane-track[data-lane]')]
  /** The bar each lane's button stands on. */
  const at = tracks.map(() => 0)
  const tab = watchTabDirection(doc)
  const template = doc.createElement('template')
  let destroyed = false
  let frame = 0

  const laneOf = (el: Element | null): number => {
    const track = el?.closest?.('.lane-track[data-lane]')
    return track && list.contains(track) ? Number((track as HTMLElement).dataset.lane) : -1
  }
  /** Lane [k]'s button (the last one: a new one goes in after the old before it goes). */
  const button = (k: number) => {
    const all = tracks[k]?.querySelectorAll<HTMLButtonElement>(':scope > .lane-bar')
    return all?.length ? all[all.length - 1] : null
  }
  const boxes = (k: number, width: number) => lanes[k].bars.map((r) => laneBarBox(r.startMs, r.spanMs, total, width))

  /** Paint lane [k]'s bars but the one its button stands on. */
  function paintLane(k: number): void {
    const track = tracks[k]
    const canvas = track?.querySelector<HTMLCanvasElement>(':scope > canvas')
    const lane: LaneTrack | undefined = lanes[k]
    if (!track || !canvas || !lane) return
    const { width, height } = track.getBoundingClientRect()
    const dpr = win?.devicePixelRatio || 1
    const w = Math.max(1, Math.round(width * dpr))
    const h = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const own = button(k)
    ctx.fillStyle = own && win ? win.getComputedStyle(own).backgroundColor : 'currentColor'
    ctx.globalAlpha = LANE_BAR_OPACITY
    const skip = at[k]
    const all = boxes(k, width)
    for (let j = 0; j < all.length; j++) {
      if (j === skip) continue
      const { x, w: bw } = all[j]
      const r = Math.min(LANE_BAR_RADIUS_PX, bw / 2, height / 2)
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, 0, bw, height, r)
      else ctx.rect(x, 0, bw, height)
      ctx.fill()
    }
  }

  function paint(): void {
    if (destroyed) return
    if (!list.isConnected) {
      destroy()
      return
    }
    for (let k = 0; k < tracks.length; k++) paintLane(k)
  }

  function schedule(): void {
    if (frame || destroyed || !win) return
    frame = win.requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }

  /**
   * Put lane [k]'s button on bar [j]. [fresh]: as a new button (keyboard moves, so focus lands on
   * it and it is announced); otherwise the same one, moved (the pointer, so hover stays on it).
   */
  function place(k: number, j: number, fresh: boolean): HTMLButtonElement | null {
    const old = button(k)
    if (!old || j < 0 || j >= lanes[k].bars.length) return old
    if (j === at[k] && !fresh) return old
    template.innerHTML = laneBarHtml(scenario, lanes[k], j)
    const next = template.content.firstElementChild as HTMLButtonElement
    if (fresh) {
      // In beside the old one, which goes once the new one has focus (focusBar), so focus never
      // drops to the page on the way.
      old.after(next)
    } else {
      for (const name of ['style', 'data-show-message', 'title', 'aria-label'])
        old.setAttribute(name, next.getAttribute(name) ?? '')
    }
    at[k] = j
    paintLane(k)
    return fresh ? next : old
  }

  function focusBar(k: number, j: number): void {
    const old = button(k)
    const next = place(k, j, true)
    next?.focus()
    if (old && next && old !== next) old.remove()
  }

  /** The bar before or after lane [k]'s bar [j] in Tab order, across lanes; null past either end. */
  function step(k: number, j: number, by: 1 | -1): [number, number] | null {
    if (j + by >= 0 && j + by < lanes[k].bars.length) return [k, j + by]
    for (let n = k + by; n >= 0 && n < tracks.length; n += by)
      if (lanes[n]?.bars.length) return [n, by > 0 ? 0 : lanes[n].bars.length - 1]
    return null
  }
  const ends = (): { first: [number, number] | null; last: [number, number] | null } => {
    let first: [number, number] | null = null
    let last: [number, number] | null = null
    for (let k = 0; k < tracks.length; k++)
      if (lanes[k]?.bars.length) {
        first ??= [k, 0]
        last = [k, lanes[k].bars.length - 1]
      }
    return { first, last }
  }

  const onKeydown = (ev: KeyboardEvent) => {
    if (ev.key !== 'Tab' || ev.altKey || ev.ctrlKey || ev.metaKey) return
    const k = laneOf(ev.target as Element | null)
    if (k < 0 || !(ev.target as Element).matches('.lane-bar')) return
    const next = step(k, at[k], ev.shiftKey ? -1 : 1)
    if (!next) return
    ev.preventDefault()
    focusBar(...next)
  }
  // Tab into the lanes lands on the first bar, Shift+Tab on the last, wherever the buttons stand.
  const onFocusin = (ev: FocusEvent) => {
    const k = laneOf(ev.target as Element | null)
    const from = ev.relatedTarget
    const tabbing = tab.now()
    if (k < 0 || !tabbing || (from instanceof Node && list.contains(from))) return
    const want = tabbing === 'forward' ? ends().first : ends().last
    if (want && (want[0] !== k || want[1] !== at[k])) focusBar(...want)
  }
  /** The bar under the pointer in lane [k], or -1. */
  const barUnder = (k: number, clientX: number): number => {
    const rect = tracks[k].getBoundingClientRect()
    return laneBarAt(boxes(k, rect.width), clientX - rect.left)
  }
  // The pointer brings the lane's button to the bar under it, so hover, its title and a click work
  // as on a bar of its own. A focused button stays where the keyboard put it.
  const onPointermove = (ev: PointerEvent) => {
    const k = laneOf(ev.target as Element | null)
    if (k < 0 || button(k) === doc.activeElement) return
    const j = barUnder(k, ev.clientX)
    if (j >= 0) place(k, j, false)
  }
  // A tap or a click that landed beside the button (no pointer move first) opens the bar under it.
  const onClick = (ev: MouseEvent) => {
    const k = laneOf(ev.target as Element | null)
    if (k < 0 || (ev.target as Element).closest('.lane-bar')) return
    const j = barUnder(k, ev.clientX)
    if (j < 0) return
    place(k, j, false)?.click()
  }

  list.addEventListener('keydown', onKeydown)
  list.addEventListener('focusin', onFocusin)
  list.addEventListener('pointermove', onPointermove, { passive: true })
  list.addEventListener('click', onClick)
  let width = -1
  const resize =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(([entry]) => {
          const w = Math.round(entry.contentRect.width)
          if (w === width) return
          width = w
          schedule()
        })
  resize?.observe(list)
  // The theme (light, dark, more contrast) changes the lane colours the canvases paint with.
  const theme = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule)
  theme?.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
  const media = ['(forced-colors: active)', `(resolution: ${win?.devicePixelRatio ?? 1}dppx)`]
    .map((q) => (typeof win?.matchMedia === 'function' ? win.matchMedia(q) : null))
    .filter((m): m is MediaQueryList => m != null)
  for (const m of media) m.addEventListener('change', schedule)

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    if (frame && win) win.cancelAnimationFrame(frame)
    frame = 0
    tab.stop()
    list.removeEventListener('keydown', onKeydown)
    list.removeEventListener('focusin', onFocusin)
    list.removeEventListener('pointermove', onPointermove)
    list.removeEventListener('click', onClick)
    resize?.disconnect()
    theme?.disconnect()
    for (const m of media) m.removeEventListener('change', schedule)
  }

  paint()
  return { paint, focusBar, destroy }
}
