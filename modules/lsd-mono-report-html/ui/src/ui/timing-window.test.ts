// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Metric, Scenario } from '../types'
import { timedReport } from '../../checks/timed-sample'
import { timeline } from '../lib/timing'
import { WATERFALL_FIRST_ROWS, laneBarAt, laneBarBox } from '../lib/timing-window'
import { bindInspector, inspectorMarkup } from './inspector'
import { laneTracks, timingPanelHtml } from './timing'
import { mountLaneCanvas, mountTimingWindow, mountWaterfallWindow } from './timing-window'

const ROW_PX = 26
/** Shorter than the window (happy-dom's 768 px), so the panel is what clips the list. */
const PANEL_PX = 600
const TRACK_PX = 500
const big: Scenario = timedReport(2000).scenarios[0]
const small: Scenario = timedReport(100).scenarios[0]
const rows = timeline(big).rows.length

/** Where the waterfall's top is on screen: the panel scrolled by -listTop. */
let listTop = 0

function rect(top: number, height: number, left = 0, width = 0): DOMRect {
  return { top, bottom: top + height, left, right: left + width, x: left, y: top, width, height, toJSON: () => ({}) }
}

function layout(this: Element): DOMRect {
  if (this.matches('ol.waterfall')) return rect(listTop, rows * ROW_PX)
  if (this.matches('ol.waterfall > li')) return rect(0, ROW_PX)
  if (this.matches('.inspector')) return rect(0, PANEL_PX)
  if (this.matches('.lane-track')) return rect(0, 20, 0, TRACK_PX)
  return rect(0, 0)
}

function open(scenario = big): HTMLElement {
  document.body.innerHTML = `<aside class="inspector"><div id="host">${timingPanelHtml(scenario)}</div></aside>`
  return document.getElementById('host')!
}

const drawn = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLLIElement>('ol.waterfall > li[data-i]')].map((li) => Number(li.dataset.i))
const row = (host: HTMLElement, i: number) =>
  host.querySelector<HTMLButtonElement>(`ol.waterfall > li[data-i="${i}"] > button`)
const focusedRow = () => Number(document.activeElement?.closest<HTMLElement>('li[data-i]')?.dataset.i ?? -1)

/** Past the Tab key's turn: a focus now is not Tab's. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function tab(target: Element, shift = false): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
  target.dispatchEvent(ev)
  return ev
}

beforeEach(() => {
  listTop = 0
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(layout)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('timing panel markup on a long timed scenario', () => {
  it('starts the waterfall with its first rows and room for the rest, each saying its place', () => {
    const host = open()
    const list = host.querySelector<HTMLElement>('ol.waterfall')!
    expect(list.dataset.waterfallWindow).toBe(big.id)
    expect(list.dataset.rows).toBe(String(rows))
    expect(drawn(host)).toEqual([...Array(WATERFALL_FIRST_ROWS).keys()])
    expect(list.style.paddingBottom).toBe(`${(rows - WATERFALL_FIRST_ROWS) * ROW_PX}px`)
    const first = host.querySelector('ol.waterfall > li')!
    expect(first.getAttribute('aria-posinset')).toBe('1')
    expect(first.getAttribute('aria-setsize')).toBe(String(rows))
  })

  it('paints the lanes, with one button per lane on its first bar', () => {
    const host = open()
    const lanes = laneTracks(timeline(big))
    expect(host.querySelector('ol.swim-lanes')!.hasAttribute('data-lane-canvas')).toBe(true)
    const tracks = [...host.querySelectorAll('.lane-track[data-lane]')]
    expect(tracks).toHaveLength(lanes.length)
    tracks.forEach((track, k) => {
      expect(track.querySelectorAll('canvas.lane-canvas[aria-hidden="true"]')).toHaveLength(1)
      const buttons = track.querySelectorAll('.lane-bar')
      expect(buttons).toHaveLength(1)
      expect(buttons[0].getAttribute('data-show-message')).toBe(lanes[k].bars[0].message.id)
    })
  })

  it('draws a short scenario in full, as before', () => {
    const host = open(small)
    expect(host.querySelector('[data-waterfall-window], [data-lane-canvas], [data-i], canvas')).toBeNull()
    expect(host.querySelectorAll('ol.waterfall > li')).toHaveLength(timeline(small).rows.length)
    expect(mountWaterfallWindow(host, small)).toBeNull()
    expect(mountLaneCanvas(host, small)).toBeNull()
    expect(() => mountTimingWindow(host, small)()).not.toThrow()
  })
})

describe('waterfall window', () => {
  it('draws the rows in view and the overscan, and moves with the scroll', () => {
    const host = open()
    const ww = mountWaterfallWindow(host, big)!
    const list = host.querySelector<HTMLElement>('ol.waterfall')!
    // In view: the panel's 800 px, plus 600 px of overscan below.
    expect(ww.range()).toEqual({ start: 0, end: Math.ceil((PANEL_PX + 600) / ROW_PX) })
    expect(drawn(host)).toEqual([...Array(ww.range().end).keys()])

    listTop = -1000 * ROW_PX
    ww.sync()
    const { start, end } = ww.range()
    expect(start).toBe(1000 - Math.round(600 / ROW_PX) - 1)
    expect(drawn(host)).toEqual(Array.from({ length: end - start }, (_, i) => start + i))
    expect(list.style.paddingTop).toBe(`${start * ROW_PX}px`)
    expect(list.style.paddingBottom).toBe(`${(rows - end) * ROW_PX}px`)
    expect(drawn(host).length).toBeLessThan(100)

    listTop = -(rows * ROW_PX)
    ww.sync()
    expect(drawn(host).at(-1)).toBe(rows - 1)
    ww.destroy()
  })

  it('keeps a focused row drawn, at its place, when the list scrolls past it', () => {
    const host = open()
    const ww = mountWaterfallWindow(host, big)!
    row(host, 3)!.focus()
    listTop = -1000 * ROW_PX
    ww.sync()
    const li = row(host, 3)!.parentElement!
    expect(document.activeElement).toBe(row(host, 3))
    expect(li.hasAttribute('data-pinned')).toBe(true)
    expect(li.style.top).toBe(`${3 * ROW_PX}px`)
    expect(drawn(host)[0]).toBe(3)
    // Back in view: in the flow again.
    listTop = 0
    ww.sync()
    expect(li.hasAttribute('data-pinned')).toBe(false)
    expect(li.style.top).toBe('')
    ww.destroy()
  })

  it('Tab and Shift+Tab step to the next row in order, drawn or not', async () => {
    const host = open()
    const ww = mountWaterfallWindow(host, big)!
    // Between drawn neighbours the browser moves focus itself.
    expect(tab(row(host, 3)!).defaultPrevented).toBe(false)
    await settle()

    row(host, 3)!.focus()
    listTop = -1000 * ROW_PX
    ww.sync()
    expect(tab(row(host, 3)!).defaultPrevented).toBe(true)
    expect(focusedRow()).toBe(4)
    ww.sync()
    // Row 3 has gone now focus is on 4.
    expect(row(host, 3)).toBeNull()
    expect(tab(row(host, 4)!, true).defaultPrevented).toBe(true)
    expect(focusedRow()).toBe(3)
    // Past either end, and other keys: left to the browser.
    ww.focusRow(rows - 1)
    expect(tab(row(host, rows - 1)!).defaultPrevented).toBe(false)
    ww.focusRow(0)
    expect(tab(row(host, 0)!, true).defaultPrevented).toBe(false)
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    row(host, 0)!.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    ww.focusRow(-1)
    ww.focusRow(rows)
    expect(focusedRow()).toBe(0)
    ww.destroy()
  })

  it('Tab into the list lands on its first row, Shift+Tab on its last', async () => {
    const host = open()
    const ww = mountWaterfallWindow(host, big)!
    listTop = -1000 * ROW_PX
    ww.sync()
    const middle = drawn(host)[10]
    tab(document.body)
    row(host, middle)!.focus()
    expect(focusedRow()).toBe(0)

    row(host, 0)!.blur()
    await settle()
    tab(document.body, true)
    row(host, middle)!.focus()
    expect(focusedRow()).toBe(rows - 1)

    // A click (no Tab) focuses the row it hit.
    row(host, rows - 1)!.blur()
    await settle()
    row(host, middle)!.focus()
    expect(focusedRow()).toBe(middle)
    ww.destroy()
  })

  it('follows scrolls and resizes once a frame, until destroyed or gone', async () => {
    const host = open()
    const ww = mountWaterfallWindow(host, big)!
    listTop = -500 * ROW_PX
    host.closest('.inspector')!.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(ww.range().start).toBeGreaterThan(400))
    listTop = -1500 * ROW_PX
    window.dispatchEvent(new Event('resize'))
    await vi.waitFor(() => expect(ww.range().start).toBeGreaterThan(1400))
    // A scroll somewhere else does nothing.
    listTop = 0
    document.body.appendChild(document.createElement('div')).dispatchEvent(new Event('scroll'))
    ww.destroy()
    document.dispatchEvent(new Event('scroll'))
    await new Promise((r) => setTimeout(r, 40))
    expect(ww.range().start).toBeGreaterThan(1400)

    const again = mountWaterfallWindow(host, big)!
    host.remove()
    expect(() => again.sync()).not.toThrow()
  })
})

describe('painted swim lanes', () => {
  const lanes = laneTracks(timeline(big))
  const track = (host: HTMLElement, k: number) => host.querySelector<HTMLElement>(`.lane-track[data-lane="${k}"]`)!
  const bar = (host: HTMLElement, k: number) => track(host, k).querySelector<HTMLButtonElement>('.lane-bar')!
  let ctx: Record<string, unknown> & { fill: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ctx as unknown as CanvasRenderingContext2D,
    )
  })

  it('paints every bar but the one its button stands on, in the button colour', () => {
    const host = open()
    const lc = mountLaneCanvas(host, big)!
    const bars = lanes.reduce((n, l) => n + l.bars.length, 0)
    expect(ctx.fill).toHaveBeenCalledTimes(bars - lanes.length)
    expect(ctx.roundRect).toHaveBeenCalledTimes(bars - lanes.length)
    expect(track(host, 0).querySelector('canvas')!.width).toBe(TRACK_PX)
    // Without roundRect, plain rectangles.
    ctx.roundRect = undefined
    ctx.fill.mockClear()
    lc.paint()
    expect(ctx.rect).toHaveBeenCalledTimes(bars - lanes.length)
    lc.destroy()
  })

  it('Tab and Shift+Tab step through every bar, lane by lane', () => {
    const host = open()
    const lc = mountLaneCanvas(host, big)!
    bar(host, 0).focus()
    expect(tab(bar(host, 0)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(bar(host, 0))
    expect(bar(host, 0).getAttribute('data-show-message')).toBe(lanes[0].bars[1].message.id)
    expect(track(host, 0).querySelectorAll('.lane-bar')).toHaveLength(1)
    tab(bar(host, 0), true)
    expect(bar(host, 0).getAttribute('data-show-message')).toBe(lanes[0].bars[0].message.id)

    // Off the end of a lane, into the next; back again.
    const last = lanes[0].bars.length - 1
    lc.focusBar(0, last)
    tab(bar(host, 0))
    expect(document.activeElement).toBe(bar(host, 1))
    expect(bar(host, 1).getAttribute('data-show-message')).toBe(lanes[1].bars[0].message.id)
    tab(bar(host, 1), true)
    expect(document.activeElement).toBe(bar(host, 0))
    expect(bar(host, 0).getAttribute('data-show-message')).toBe(lanes[0].bars[last].message.id)

    // Past the first bar and the last: left to the browser.
    lc.focusBar(0, 0)
    expect(tab(bar(host, 0), true).defaultPrevented).toBe(false)
    const k = lanes.length - 1
    lc.focusBar(k, lanes[k].bars.length - 1)
    expect(tab(bar(host, k)).defaultPrevented).toBe(false)
    lc.destroy()
  })

  it('Tab into the lanes lands on the first bar, Shift+Tab on the last', async () => {
    const host = open()
    const lc = mountLaneCanvas(host, big)!
    tab(document.body)
    bar(host, 2).focus()
    expect(document.activeElement).toBe(bar(host, 0))
    expect(bar(host, 0).getAttribute('data-show-message')).toBe(lanes[0].bars[0].message.id)

    bar(host, 0).blur()
    await settle()
    tab(document.body, true)
    bar(host, 0).focus()
    const k = lanes.length - 1
    expect(document.activeElement).toBe(bar(host, k))
    expect(bar(host, k).getAttribute('data-show-message')).toBe(lanes[k].bars.at(-1)!.message.id)
    lc.destroy()
  })

  it('brings the button to the bar under the pointer, and a click beside it opens that bar', () => {
    const host = open()
    const lc = mountLaneCanvas(host, big)!
    const boxes = lanes[0].bars.map((r) => laneBarBox(r.startMs, r.spanMs, timeline(big).totalMs, TRACK_PX))
    const x = boxes[Math.floor(boxes.length * 0.6)].x + 1
    const under = lanes[0].bars[laneBarAt(boxes, x)].message.id
    const button = bar(host, 0)
    track(host, 0).dispatchEvent(new PointerEvent('pointermove', { clientX: x, bubbles: true }))
    expect(bar(host, 0)).toBe(button)
    expect(button.getAttribute('data-show-message')).toBe(under)
    expect(button.getAttribute('aria-label')).toContain(lanes[0].bars[0].message.label)

    // Nothing under the pointer: the button stays.
    track(host, 0).dispatchEvent(new PointerEvent('pointermove', { clientX: TRACK_PX * 10, bubbles: true }))
    expect(button.getAttribute('data-show-message')).toBe(under)

    const opened: string[] = []
    host.addEventListener('click', (ev) => {
      const id = (ev.target as Element).getAttribute('data-show-message')
      if (id) opened.push(id)
    })
    const first = boxes[0].x + 1
    track(host, 0).dispatchEvent(new MouseEvent('click', { clientX: first, bubbles: true }))
    expect(opened).toEqual([lanes[0].bars[laneBarAt(boxes, first)].message.id])
    track(host, 0).dispatchEvent(new MouseEvent('click', { clientX: TRACK_PX * 10, bubbles: true }))
    expect(opened).toHaveLength(1)

    // A focused button stays where the keyboard put it.
    button.focus()
    track(host, 0).dispatchEvent(new PointerEvent('pointermove', { clientX: x, bubbles: true }))
    expect(button.getAttribute('data-show-message')).toBe(lanes[0].bars[laneBarAt(boxes, first)].message.id)
    lc.destroy()
  })

  it('paints again when the theme changes, until destroyed or gone', async () => {
    const host = open()
    const lc = mountLaneCanvas(host, big)!
    ctx.fill.mockClear()
    document.documentElement.setAttribute('data-theme', 'dark')
    await vi.waitFor(() => expect(ctx.fill).toHaveBeenCalled())
    lc.destroy()
    ctx.fill.mockClear()
    lc.paint()
    expect(ctx.fill).not.toHaveBeenCalled()
    document.documentElement.removeAttribute('data-theme')

    const again = mountLaneCanvas(host, big)!
    host.remove()
    ctx.fill.mockClear()
    again.paint()
    expect(ctx.fill).not.toHaveBeenCalled()
  })
})

describe('metrics view mount (#90b)', () => {
  const metrics: Metric[] = [{ key: 'Messages', value: '14' }]

  it('mounts once drawn, and undoes it when the view opens again or closes', () => {
    document.body.innerHTML = `<div class="shell" id="shell">${inspectorMarkup()}</div>`
    const controller = bindInspector(document, { loadPayload: async () => undefined, onClose: () => {} })
    const undo = vi.fn()
    const mount = vi.fn((host: HTMLElement) => {
      expect(host.textContent).toContain('Messages')
      return undo
    })
    controller.openMetrics('pay', { heading: 'Happy path', metrics, mount })
    expect(mount).toHaveBeenCalledTimes(1)
    controller.openMetrics('pay', { heading: 'Happy path', metrics })
    expect(undo).toHaveBeenCalledTimes(1)
    controller.openMetrics('pay', { heading: 'Happy path', metrics, mount })
    controller.close()
    expect(undo).toHaveBeenCalledTimes(2)
  })
})
