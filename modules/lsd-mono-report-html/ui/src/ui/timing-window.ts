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

/** Call [onWidth] when [element]'s content width changes. [previous] is -1 the first time. */
function observeWidth(
  element: Element,
  onWidth: (width: number, previous: number) => void,
): { disconnect: () => void } {
  let width = -1
  const resize =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(([entry]) => {
          const w = Math.round(entry.contentRect.width)
          if (w === width) return
          const previous = width
          width = w
          onWidth(w, previous)
        })
  resize?.observe(element)
  return { disconnect: () => resize?.disconnect() }
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

type WaterfallState = {
  list: HTMLOListElement
  doc: Document
  win: Window | null
  count: number
  heights: RowHeights
  drawn: Map<number, HTMLLIElement>
  start: number
  end: number
  estimated: boolean
  frame: number
  destroyed: boolean
  template: HTMLTemplateElement
  scenario: Scenario
  destroy: () => void
}

function waterfallIndexOf(list: HTMLOListElement, el: Element | null): number | null {
  const li = el?.closest?.('li[data-i]')
  return li && li.parentElement === list ? Number((li as HTMLElement).dataset.i) : null
}

function focusedWaterfallRow(state: WaterfallState): number | null {
  return waterfallIndexOf(state.list, state.doc.activeElement)
}

/** The window and the side panel (where it scrolls) clip the list. */
function waterfallClips(list: HTMLOListElement, win: Window | null): { top: number; bottom: number }[] {
  const out: { top: number; bottom: number }[] = [{ top: 0, bottom: win?.innerHeight ?? Infinity }]
  const panel = list.closest<HTMLElement>('.inspector')
  if (panel) {
    const r = panel.getBoundingClientRect()
    out.push({ top: r.top, bottom: r.bottom })
  }
  return out
}

/** Draw [from, to) in the flow, plus [extra] (focused rows) wherever they are, and nothing else. */
function drawWaterfall(state: WaterfallState, from: number, to: number, extra: readonly (number | null)[]): void {
  const { list, drawn, count, template, scenario } = state
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
  state.start = from
  state.end = to
  placeWaterfall(state)
}

/** The padding that stands in for the rows not drawn, and rows kept outside the flow, at their place. */
function placeWaterfall(state: WaterfallState): void {
  const { list, drawn, heights } = state
  list.style.paddingTop = `${heights.top(state.start)}px`
  list.style.paddingBottom = `${Math.max(0, heights.total() - heights.top(state.end))}px`
  for (const [i, li] of drawn) {
    const pinned = i < state.start || i >= state.end
    li.toggleAttribute('data-pinned', pinned)
    li.style.top = pinned ? `${heights.top(i)}px` : ''
  }
}

/** Read the drawn rows' heights. True when the offsets changed. */
function measureWaterfall(state: WaterfallState): boolean {
  let changed = false
  const seen: number[] = []
  for (const [i, li] of state.drawn) {
    const h = li.getBoundingClientRect().height
    if (h > 0) seen.push(h)
    if (state.heights.set(i, h)) changed = true
  }
  // Rows not drawn yet are guessed from the ones that are, once per width.
  if (!state.estimated && seen.length) {
    seen.sort((a, b) => a - b)
    if (state.heights.setEstimate(seen[seen.length >> 1])) changed = true
    state.estimated = true
  }
  return changed
}

function syncWaterfall(state: WaterfallState): void {
  if (state.destroyed) return
  if (!state.list.isConnected) {
    state.destroy()
    return
  }
  // Three passes at most: measuring the rows just drawn can move the rows that should be drawn.
  for (let pass = 0; pass < 3; pass++) {
    const span = visibleSpan(state.list.getBoundingClientRect(), waterfallClips(state.list, state.win))
    const next = waterfallRange({ offsets: state.heights.offsets(), top: span.top, bottom: span.bottom })
    const focused = focusedWaterfallRow(state)
    if (pass > 0 && next.start === state.start && next.end === state.end) break
    drawWaterfall(state, next.start, next.end, [focused])
    if (!measureWaterfall(state)) break
    placeWaterfall(state)
  }
}

function scheduleWaterfall(state: WaterfallState): void {
  if (state.frame || state.destroyed || !state.win) return
  state.frame = state.win.requestAnimationFrame(() => {
    state.frame = 0
    syncWaterfall(state)
  })
}

function focusWaterfallRow(state: WaterfallState, i: number): void {
  if (i < 0 || i >= state.count) return
  // The row focused now stays drawn until the new one has focus, so focus never drops to the page.
  drawWaterfall(state, state.start, state.end, [focusedWaterfallRow(state), i])
  state.drawn.get(i)?.querySelector<HTMLElement>('button')?.focus()
  scheduleWaterfall(state)
}

function onWaterfallScroll(state: WaterfallState, ev: Event): void {
  const target = ev.target
  if (target === state.doc || (target instanceof Node && target.contains(state.list))) scheduleWaterfall(state)
}

function onWaterfallKeydown(state: WaterfallState, ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || ev.altKey || ev.ctrlKey || ev.metaKey) return
  const i = waterfallIndexOf(state.list, ev.target as Element | null)
  if (i == null) return
  const next = ev.shiftKey ? i - 1 : i + 1
  if (next < 0 || next >= state.count) return
  const li = state.drawn.get(i)!
  const sibling = ev.shiftKey ? li.previousElementSibling : li.nextElementSibling
  if (sibling && sibling === state.drawn.get(next)) return
  ev.preventDefault()
  focusWaterfallRow(state, next)
}

function onWaterfallFocusin(state: WaterfallState, ev: FocusEvent, tab: { now: () => Direction | null }): void {
  const i = waterfallIndexOf(state.list, ev.target as Element | null)
  const from = ev.relatedTarget
  const tabbing = tab.now()
  if (i == null || !tabbing || (from instanceof Node && state.list.contains(from))) return
  const want = tabbing === 'forward' ? 0 : state.count - 1
  if (i !== want) focusWaterfallRow(state, want)
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
  const tab = watchTabDirection(doc)
  const state: WaterfallState = {
    list,
    doc,
    win,
    count,
    heights,
    drawn,
    start: 0,
    end: drawn.size,
    estimated: false,
    frame: 0,
    destroyed: false,
    template: doc.createElement('template'),
    scenario,
    destroy: () => {},
  }

  const onScroll = (ev: Event) => onWaterfallScroll(state, ev)
  const onKeydown = (ev: KeyboardEvent) => onWaterfallKeydown(state, ev)
  const onFocusin = (ev: FocusEvent) => onWaterfallFocusin(state, ev, tab)
  const onResize = () => scheduleWaterfall(state)
  const resize = observeWidth(list, (_w, previous) => {
    // A new width can wrap rows differently: measure them again.
    if (previous >= 0) {
      heights.reset()
      state.estimated = false
    }
    scheduleWaterfall(state)
  })

  function destroy(): void {
    if (state.destroyed) return
    state.destroyed = true
    if (state.frame && win) win.cancelAnimationFrame(state.frame)
    state.frame = 0
    doc.removeEventListener('scroll', onScroll, { capture: true })
    tab.stop()
    win?.removeEventListener('resize', onResize)
    list.removeEventListener('keydown', onKeydown)
    list.removeEventListener('focusin', onFocusin)
    resize.disconnect()
  }
  state.destroy = destroy

  doc.addEventListener('scroll', onScroll, { capture: true, passive: true })
  win?.addEventListener('resize', onResize)
  list.addEventListener('keydown', onKeydown)
  list.addEventListener('focusin', onFocusin)

  syncWaterfall(state)
  return {
    sync: () => syncWaterfall(state),
    focusRow: (i) => focusWaterfallRow(state, i),
    range: () => ({ start: state.start, end: state.end }),
    destroy,
  }
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

type LaneState = {
  list: HTMLOListElement
  doc: Document
  win: Window | null
  scenario: Scenario
  lanes: LaneTrack[]
  tracks: HTMLElement[]
  at: number[]
  template: HTMLTemplateElement
  destroyed: boolean
  frame: number
  total: number
  destroy: () => void
}

function laneOf(state: LaneState, el: Element | null): number {
  const track = el?.closest?.('.lane-track[data-lane]')
  return track && state.list.contains(track) ? Number((track as HTMLElement).dataset.lane) : -1
}

/** Lane [k]'s button (the last one: a new one goes in after the old before it goes). */
function laneButton(state: LaneState, k: number): HTMLButtonElement | null {
  const all = state.tracks[k]?.querySelectorAll<HTMLButtonElement>(':scope > .lane-bar')
  return all?.length ? all[all.length - 1] : null
}

function laneBoxes(state: LaneState, k: number, width: number) {
  return state.lanes[k].bars.map((r) => laneBarBox(r.startMs, r.spanMs, state.total, width))
}

/** Paint lane [k]'s bars but the one its button stands on. */
function paintLane(state: LaneState, k: number): void {
  const track = state.tracks[k]
  const canvas = track?.querySelector<HTMLCanvasElement>(':scope > canvas')
  const lane: LaneTrack | undefined = state.lanes[k]
  if (!track || !canvas || !lane) return
  const { width, height } = track.getBoundingClientRect()
  const dpr = state.win?.devicePixelRatio || 1
  const w = Math.max(1, Math.round(width * dpr))
  const h = Math.max(1, Math.round(height * dpr))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const own = laneButton(state, k)
  ctx.fillStyle = own && state.win ? state.win.getComputedStyle(own).backgroundColor : 'currentColor'
  ctx.globalAlpha = LANE_BAR_OPACITY
  const skip = state.at[k]
  const all = laneBoxes(state, k, width)
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

function paintLanes(state: LaneState): void {
  if (state.destroyed) return
  if (!state.list.isConnected) {
    state.destroy()
    return
  }
  for (let k = 0; k < state.tracks.length; k++) paintLane(state, k)
}

function scheduleLanes(state: LaneState): void {
  if (state.frame || state.destroyed || !state.win) return
  state.frame = state.win.requestAnimationFrame(() => {
    state.frame = 0
    paintLanes(state)
  })
}

/**
 * Put lane [k]'s button on bar [j]. [fresh]: as a new button (keyboard moves, so focus lands on
 * it and it is announced); otherwise the same one, moved (the pointer, so hover stays on it).
 */
function placeLaneBar(state: LaneState, k: number, j: number, fresh: boolean): HTMLButtonElement | null {
  const old = laneButton(state, k)
  if (!old || j < 0 || j >= state.lanes[k].bars.length) return old
  if (j === state.at[k] && !fresh) return old
  state.template.innerHTML = laneBarHtml(state.scenario, state.lanes[k], j)
  const next = state.template.content.firstElementChild as HTMLButtonElement
  if (fresh) {
    // In beside the old one, which goes once the new one has focus (focusBar), so focus never
    // drops to the page on the way.
    old.after(next)
  } else {
    for (const name of ['style', 'data-show-message', 'title', 'aria-label'])
      old.setAttribute(name, next.getAttribute(name) ?? '')
  }
  state.at[k] = j
  paintLane(state, k)
  return fresh ? next : old
}

function focusLaneBar(state: LaneState, k: number, j: number): void {
  const old = laneButton(state, k)
  const next = placeLaneBar(state, k, j, true)
  next?.focus()
  if (old && next && old !== next) old.remove()
}

/** The bar before or after lane [k]'s bar [j] in Tab order, across lanes; null past either end. */
function stepLaneBar(state: LaneState, k: number, j: number, by: 1 | -1): [number, number] | null {
  if (j + by >= 0 && j + by < state.lanes[k].bars.length) return [k, j + by]
  for (let n = k + by; n >= 0 && n < state.tracks.length; n += by)
    if (state.lanes[n]?.bars.length) return [n, by > 0 ? 0 : state.lanes[n].bars.length - 1]
  return null
}

function laneEnds(state: LaneState): { first: [number, number] | null; last: [number, number] | null } {
  let first: [number, number] | null = null
  let last: [number, number] | null = null
  for (let k = 0; k < state.tracks.length; k++)
    if (state.lanes[k]?.bars.length) {
      first ??= [k, 0]
      last = [k, state.lanes[k].bars.length - 1]
    }
  return { first, last }
}

function onLaneKeydown(state: LaneState, ev: KeyboardEvent): void {
  if (ev.key !== 'Tab' || ev.altKey || ev.ctrlKey || ev.metaKey) return
  const k = laneOf(state, ev.target as Element | null)
  if (k < 0 || !(ev.target as Element).matches('.lane-bar')) return
  const next = stepLaneBar(state, k, state.at[k], ev.shiftKey ? -1 : 1)
  if (!next) return
  ev.preventDefault()
  focusLaneBar(state, ...next)
}

function onLaneFocusin(state: LaneState, ev: FocusEvent, tab: { now: () => Direction | null }): void {
  const k = laneOf(state, ev.target as Element | null)
  const from = ev.relatedTarget
  const tabbing = tab.now()
  if (k < 0 || !tabbing || (from instanceof Node && state.list.contains(from))) return
  const want = tabbing === 'forward' ? laneEnds(state).first : laneEnds(state).last
  if (want && (want[0] !== k || want[1] !== state.at[k])) focusLaneBar(state, ...want)
}

/** The bar under the pointer in lane [k], or -1. */
function barUnderPointer(state: LaneState, k: number, clientX: number): number {
  const rect = state.tracks[k].getBoundingClientRect()
  return laneBarAt(laneBoxes(state, k, rect.width), clientX - rect.left)
}

function onLanePointermove(state: LaneState, ev: PointerEvent): void {
  const k = laneOf(state, ev.target as Element | null)
  if (k < 0 || laneButton(state, k) === state.doc.activeElement) return
  const j = barUnderPointer(state, k, ev.clientX)
  if (j >= 0) placeLaneBar(state, k, j, false)
}

function onLaneClick(state: LaneState, ev: MouseEvent): void {
  const k = laneOf(state, ev.target as Element | null)
  if (k < 0 || (ev.target as Element).closest('.lane-bar')) return
  const j = barUnderPointer(state, k, ev.clientX)
  if (j < 0) return
  placeLaneBar(state, k, j, false)?.click()
}

/** Repaint when the theme (light, dark, more contrast) or the screen's pixel density changes. */
function watchThemeAndResolution(doc: Document, win: Window | null, onChange: () => void): { stop: () => void } {
  const theme = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onChange)
  theme?.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
  const media = ['(forced-colors: active)', `(resolution: ${win?.devicePixelRatio ?? 1}dppx)`]
    .map((q) => (typeof win?.matchMedia === 'function' ? win.matchMedia(q) : null))
    .filter((m): m is MediaQueryList => m != null)
  for (const m of media) m.addEventListener('change', onChange)
  return {
    stop: () => {
      theme?.disconnect()
      for (const m of media) m.removeEventListener('change', onChange)
    },
  }
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
  const tracks = [...list.querySelectorAll<HTMLElement>('.lane-track[data-lane]')]
  const tab = watchTabDirection(doc)
  const state: LaneState = {
    list,
    doc,
    win,
    scenario,
    lanes: laneTracks(t),
    tracks,
    at: tracks.map(() => 0),
    template: doc.createElement('template'),
    destroyed: false,
    frame: 0,
    total: t.totalMs || 1,
    destroy: () => {},
  }

  const onKeydown = (ev: KeyboardEvent) => onLaneKeydown(state, ev)
  const onFocusin = (ev: FocusEvent) => onLaneFocusin(state, ev, tab)
  const onPointermove = (ev: PointerEvent) => onLanePointermove(state, ev)
  const onClick = (ev: MouseEvent) => onLaneClick(state, ev)
  const onChange = () => scheduleLanes(state)
  const resize = observeWidth(list, onChange)
  const theme = watchThemeAndResolution(doc, win, onChange)

  function destroy(): void {
    if (state.destroyed) return
    state.destroyed = true
    if (state.frame && win) win.cancelAnimationFrame(state.frame)
    state.frame = 0
    tab.stop()
    list.removeEventListener('keydown', onKeydown)
    list.removeEventListener('focusin', onFocusin)
    list.removeEventListener('pointermove', onPointermove)
    list.removeEventListener('click', onClick)
    resize.disconnect()
    theme.stop()
  }
  state.destroy = destroy

  list.addEventListener('keydown', onKeydown)
  list.addEventListener('focusin', onFocusin)
  list.addEventListener('pointermove', onPointermove, { passive: true })
  list.addEventListener('click', onClick)

  paintLanes(state)
  return { paint: () => paintLanes(state), focusBar: (lane, bar) => focusLaneBar(state, lane, bar), destroy }
}
