// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scenario } from '../types'
import { bindComponentViews, componentViewHtml, mountedComponents, observedComponentScrolls } from './component-view'
import { zoomModeAfter } from './diagram/zoom-mode'
import { diagramKeyContext } from './diagram/diagram-keys'
import { registerZoomKeys } from './diagram/zoom-keys'
import { createKeyRouter } from './keys/router'
import { zoomControlsHtml } from './diagram/zoom-readout'
import { zoomAnnouncement } from './diagram-view'
import {
  bindComponentZoom,
  componentOverviewNeeded,
  componentOverviewScale,
  componentZoom,
  componentZoomShown,
  isComponentScroll,
  runComponentZoom,
} from './component-zoom'

let n = 0
function scenario(): Scenario {
  n++
  return {
    id: `pay-${n}`,
    title: 'Pay',
    status: 'success',
    facts: [],
    metrics: [],
    participants: [
      { id: 'a', name: 'Shop', type: 'PARTICIPANT' },
      { id: 'b', name: 'Bank', type: 'PARTICIPANT' },
    ],
    events: [{ kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'charge', type: 'SYNCHRONOUS' }],
  } as unknown as Scenario
}

/** A Components view whose scrollport has [room] (px) and scrolls like a real one. */
function view(room: { width: number; height: number }): { scroller: HTMLElement; id: string } {
  const s = scenario()
  document.body.innerHTML = `<section class="diagram-panel"><span class="diagram-view-status" role="status"></span>${componentViewHtml(
    s,
    zoomControlsHtml(componentZoomShown(s.id)),
  )}</section>`
  const scroller = document.querySelector<HTMLElement>('.comp-scroll')!
  setRoom(scroller, room)
  return { scroller, id: s.id }
}

/** A ResizeObserver the tests fire by hand; the Components views share one (#105 N4). */
const observers: FakeObserver[] = []
class FakeObserver {
  readonly watched = new Set<Element>()
  constructor(readonly run: ResizeObserverCallback) {
    observers.push(this)
  }
  observe(el: Element): void {
    this.watched.add(el)
  }
  unobserve(el: Element): void {
    this.watched.delete(el)
  }
  disconnect(): void {
    this.watched.clear()
  }
  fire(el: Element): void {
    this.run([{ target: el } as ResizeObserverEntry], this)
  }
}
vi.stubGlobal('ResizeObserver', FakeObserver)

/** Give [scroller] a new room, as a resize would. */
function setRoom(scroller: HTMLElement, room: { width: number; height: number }): void {
  scroller.style.maxHeight = `${room.height}px`
  Object.defineProperty(scroller, 'clientWidth', { value: room.width, configurable: true })
  Object.defineProperty(scroller, 'clientHeight', { value: room.height, configurable: true })
  scroller.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: room.width, bottom: room.height, width: room.width, height: room.height }) as DOMRect
}

/** The page's key router with the zoom keys only, as in zoom-controls.test.ts. */
const router = createKeyRouter((e) => ({
  dialog: null,
  panel: null,
  page: null,
  diagram: diagramKeyContext(e.target, { singleKeys: true, panelOpen: false }),
}))
registerZoomKeys(router)
router.listen(document)

function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(ev)
  return ev
}

const inOverview = (id: string) => componentZoom(id).mode.kind === 'overview'

const status = () => document.querySelector('.diagram-view-status')!.textContent
const button = (zoom: string) => document.querySelector<HTMLElement>(`[data-zoom="${zoom}"]`)!

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('Components Overview sizes (#105)', () => {
  it('fits both ways, between 10% and 100%, and needs a drawing bigger than its room', () => {
    expect(componentOverviewScale(1000, 500, 500, 500)).toBe(0.5)
    expect(componentOverviewScale(500, 2000, 1000, 500)).toBe(0.25)
    expect(componentOverviewScale(888, 9048, 1000, 780)).toBe(0.1)
    expect(componentOverviewScale(200, 100, 1000, 800)).toBe(1)
    expect(componentOverviewScale(0, 100, 1000, 800)).toBe(1)
    expect(componentOverviewNeeded(1091, 928, 1017, 780)).toBe(true)
    expect(componentOverviewNeeded(500, 300, 1017, 780)).toBe(false)
    expect(componentOverviewNeeded(500, 300, 0, 780)).toBe(false)
  })

  it('says how many components Overview shows', () => {
    expect(zoomAnnouncement({ kind: 'overview', zoom: 0.1, shown: 7, total: 100, unit: 'components' })).toBe(
      'Overview, 10%, 7 of 100 components shown',
    )
    expect(zoomAnnouncement({ kind: 'overview', zoom: 0.1, shown: 7, total: 100 })).toBe(
      'Overview, 10%, 7 of 100 lanes shown',
    )
  })
})

describe('Components zoom', () => {
  it('starts at 100%, steps the ladder keeping the middle, and goes back with 0', () => {
    const { scroller, id } = view({ width: 100, height: 60 })
    expect(isComponentScroll(scroller)).toBe(true)
    const drawn = mountedComponents(id)!
    bindComponentZoom(scroller)
    button('in').click()
    expect(componentZoom(id).zoom).toBe(1.1)
    expect(scroller.style.getPropertyValue('--comp-w')).toBe(`${drawn.width * 1.1}px`)
    expect(status()).toBe('Zoom 110%')
    expect(button('reset').textContent).toBe('110%')
    runComponentZoom(scroller, 'out')
    runComponentZoom(scroller, 'out')
    expect(componentZoom(id).zoom).toBe(0.9)
    runComponentZoom(scroller, 'reset')
    expect(componentZoom(id).zoom).toBe(1)
    expect(status()).toBe('Default zoom, 100%')
  })

  it('Overview fits a drawing bigger than its room, Esc goes back, and a click in it goes to 100%', () => {
    const { scroller, id } = view({ width: 40, height: 30 })
    bindComponentZoom(scroller)
    expect(button('overview').getAttribute('aria-disabled')).toBeNull()
    runComponentZoom(scroller, 'overview')
    const state = componentZoom(id)
    expect(state.mode).toMatchObject({
      kind: 'overview',
      saved: { zoom: 1, left: 0, top: 0, mode: { kind: 'default' } },
    })
    expect(state.zoom).toBeLessThan(1)
    expect(button('overview').getAttribute('aria-pressed')).toBe('true')
    expect(status()).toMatch(/^Overview, \d+%/)
    runComponentZoom(scroller, 'leave')
    expect(inOverview(id)).toBe(false)
    expect(state.zoom).toBe(1)
    expect(status()).toBe('Overview off, zoom 100%')
    runComponentZoom(scroller, 'leave')
    expect(state.zoom).toBe(1)

    // The toggle twice, and + from Overview leaves it without going back.
    runComponentZoom(scroller, 'overview')
    runComponentZoom(scroller, 'overview')
    expect(inOverview(id)).toBe(false)
    runComponentZoom(scroller, 'overview')
    runComponentZoom(scroller, 'in')
    expect(inOverview(id)).toBe(false)
    expect(status()).toMatch(/^Overview off, zoom/)

    runComponentZoom(scroller, 'overview')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    scroller.querySelector('svg')!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(inOverview(id)).toBe(false)
    expect(state.zoom).toBe(1)
    // Out of Overview a click is the link's.
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true })
    scroller.querySelector('svg')!.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
  })

  it('a drawing that fits has Overview disabled, and Shift+1 says so', () => {
    const { scroller, id } = view({ width: 5000, height: 5000 })
    bindComponentZoom(scroller)
    expect(button('overview').getAttribute('aria-disabled')).toBe('true')
    expect(button('overview').getAttribute('title')).toBe('Whole diagram already fits')
    runComponentZoom(scroller, 'overview')
    expect(inOverview(id)).toBe(false)
    expect(status()).toBe('Whole diagram already fits, zoom 100%')
    // A disabled button does nothing.
    button('overview').click()
    expect(inOverview(id)).toBe(false)
  })

  it('Ctrl+wheel steps one level per notch; a plain wheel scrolls', () => {
    const { scroller, id } = view({ width: 100, height: 60 })
    bindComponentZoom(scroller)
    // happy-dom's WheelEvent leaves out ctrlKey: the fields are set by hand.
    const wheelOf = (ctrlKey: boolean) =>
      Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 100, deltaMode: 0, ctrlKey, metaKey: false })
    scroller.dispatchEvent(wheelOf(false))
    expect(componentZoom(id).zoom).toBe(1)
    const wheel = wheelOf(true)
    scroller.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(componentZoom(id).zoom).toBe(0.9)
  })

  it('an Overview kept from before the view was drawn again is fitted again', () => {
    const { scroller, id } = view({ width: 40, height: 30 })
    componentZoom(id).mode = zoomModeAfter(componentZoom(id).mode, {
      kind: 'enter-overview',
      at: { zoom: 1, left: 0, top: 0 },
    })
    componentZoom(id).zoom = 0.5
    bindComponentZoom(scroller)
    expect(componentZoom(id).zoom).not.toBe(0.5)
    expect(button('overview').getAttribute('aria-pressed')).toBe('true')
  })

  it('Overview fits again when its room changes, like the sequence side; other zooms stay (N1)', () => {
    const { scroller, id } = view({ width: 40, height: 30 })
    bindComponentZoom(scroller)
    const observer = observers.at(-1)!
    runComponentZoom(scroller, 'overview')
    const first = componentZoom(id).zoom
    // The side panel opens: the room narrows, and Overview fits the new room.
    setRoom(scroller, { width: 10, height: 30 })
    observer.fire(scroller)
    const narrower = componentZoom(id).zoom
    expect(narrower).toBeLessThan(first)
    expect(inOverview(id)).toBe(true)
    // Half a pixel either way is not a change of room.
    setRoom(scroller, { width: 10.5, height: 30.5 })
    observer.fire(scroller)
    expect(componentZoom(id).zoom).toBe(narrower)
    // The user's own zoom is kept through a resize.
    runComponentZoom(scroller, 'in')
    const own = componentZoom(id).zoom
    setRoom(scroller, { width: 400, height: 300 })
    observer.fire(scroller)
    expect(componentZoom(id).zoom).toBe(own)
  })

  it('a hidden view waits: Overview fits once the view has a width again', () => {
    const { scroller, id } = view({ width: 40, height: 30 })
    bindComponentZoom(scroller)
    runComponentZoom(scroller, 'overview')
    const shown = componentZoom(id).zoom
    setRoom(scroller, { width: 0, height: 30 })
    observers.at(-1)!.fire(scroller)
    expect(componentZoom(id).zoom).toBe(shown)
    setRoom(scroller, { width: 10, height: 30 })
    observers.at(-1)!.fire(scroller)
    expect(componentZoom(id).zoom).toBeLessThan(shown)
  })

  it('every Components scrollport shares one observer, which lets go of those a redraw removed (N4)', () => {
    const { scroller } = view({ width: 40, height: 30 })
    bindComponentViews(document, () => {})
    bindComponentZoom(scroller)
    const count = observers.length
    expect(observedComponentScrolls()).toContain(scroller)
    const { scroller: redrawn } = view({ width: 40, height: 30 })
    bindComponentViews(document, () => {})
    bindComponentZoom(redrawn)
    expect(observers.length).toBe(count)
    expect(observers.at(-1)!.watched.has(scroller)).toBe(false)
    expect(observers.at(-1)!.watched.has(redrawn)).toBe(true)
    expect(observedComponentScrolls()).not.toContain(scroller)
  })

  it('a key in the Components view reads that view: its scrollport, no message, and its Overview', () => {
    const { scroller, id } = view({ width: 40, height: 30 })
    const link = scroller.querySelector('.edge-group')!
    const page = { singleKeys: true, panelOpen: false }
    expect(diagramKeyContext(link, page)).toMatchObject({
      on: 'card',
      zoomable: true,
      overview: false,
      messageId: null,
      scrollport: scroller,
    })
    expect(diagramKeyContext(button('in'), page)?.scrollport).toBe(scroller)
    bindComponentZoom(scroller)
    runComponentZoom(scroller, 'overview')
    expect(diagramKeyContext(link, page)?.overview).toBe(true)
    // A drawing that is not mounted is not zoomed by keys.
    document.body.innerHTML =
      '<div class="comp-diagram"><div class="comp-scroll" data-scenario-id="gone"><g id="x"></g></div></div>'
    expect(diagramKeyContext(document.querySelector('#x'), page)).toMatchObject({ zoomable: false, overview: false })
    expect(inOverview(id)).toBe(true)
  })

  it('the zoom keys zoom the Components view, and Esc leaves only Overview there', () => {
    const { scroller, id } = view({ width: 40, height: 30 })
    bindComponentZoom(scroller)
    const link = scroller.querySelector('.edge-group')!
    expect(press(link, '+').defaultPrevented).toBe(true)
    expect(componentZoom(id).zoom).toBe(1.1)
    press(link, '0')
    expect(componentZoom(id).zoom).toBe(1)
    expect(press(link, 'Escape').defaultPrevented, 'Esc out of Overview is not the view’s').toBe(false)
    press(link, '!', { shiftKey: true, code: 'Digit1' })
    expect(inOverview(id)).toBe(true)
    expect(press(link, 'Escape').defaultPrevented).toBe(true)
    expect(inOverview(id)).toBe(false)
    expect(componentZoom(id).zoom).toBe(1)
  })

  it('does nothing for a scrollport with no drawing', () => {
    document.body.innerHTML = '<div class="comp-scroll" data-scenario-id="none"></div>'
    const scroller = document.querySelector<HTMLElement>('.comp-scroll')!
    expect(() => {
      bindComponentZoom(scroller)
      runComponentZoom(scroller, 'in')
      runComponentZoom(scroller, 'overview')
    }).not.toThrow()
  })
})
