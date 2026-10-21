// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scenario } from '../types'
import { bindComponentViews, componentViewHtml, mountedComponents, observedComponentScrolls } from './component-view'
import { zoomModeAfter } from './diagram/zoom-mode'
import { diagramKeyContext } from './diagram/diagram-keys'
import { registerZoomKeys } from './diagram/zoom-keys'
import { createKeyRouter } from './keys/router'
import { zoomControlsHtml, zoomHintHtml } from './diagram/zoom-readout'
import { stepZoom, zoomAnnouncement } from './diagram-view'
import {
  bindComponentZoom,
  busiestNode,
  componentOverviewNeeded,
  componentOverviewScale,
  componentTooSmallSaid,
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
function view(
  room: { width: number; height: number },
  s: Scenario = scenario(),
): { scroller: HTMLElement; id: string } {
  const shown = componentZoomShown(s.id)
  document.body.innerHTML = `<div class="shell"><section class="diagram-panel"><span class="diagram-view-status" role="status"></span>${componentViewHtml(
    s,
    zoomControlsHtml(shown) + zoomHintHtml(shown),
  )}</section></div>`
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

  it('has nothing more to fit once the drawing fits at its zoom, or at the floor (#120)', () => {
    // The default view is the fit: there, Overview has nothing to do.
    expect(componentOverviewNeeded(1000, 500, 500, 500, 0.5)).toBe(false)
    // At 100% the same drawing overflows, so it has.
    expect(componentOverviewNeeded(1000, 500, 500, 500, 1)).toBe(true)
    // At the floor it cannot fit any more.
    expect(componentOverviewNeeded(888, 9048, 1000, 780, 0.1)).toBe(false)
  })

  it('the busiest node has the most links, the first such in graph order (#120)', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(
      busiestNode({
        nodes,
        edges: [
          { from: 'a', to: 'b' },
          { from: 'c', to: 'b' },
          { from: 'b', to: 'b' },
        ],
      }),
    ).toBe('b')
    expect(busiestNode({ nodes, edges: [] })).toBe('a')
    expect(busiestNode({ nodes: [], edges: [] })).toBeNull()
  })

  it('says how many components Overview shows', () => {
    expect(zoomAnnouncement({ kind: 'overview', zoom: 1, shown: 7, total: 100, unit: 'components' })).toBe(
      'Overview, 100%, 7 of 100 components shown',
    )
    expect(zoomAnnouncement({ kind: 'overview', zoom: 1, shown: 7, total: 100 })).toBe(
      'Overview, 100%, 7 of 100 lanes shown',
    )
  })
})

describe('Components zoom', () => {
  it('opens on the whole graph, steps the ladder from there, and goes back to the fit with 0 (#120)', () => {
    const { scroller, id } = view({ width: 100, height: 60 })
    expect(isComponentScroll(scroller)).toBe(true)
    const drawn = mountedComponents(id)!
    bindComponentZoom(scroller)
    const fit = componentOverviewScale(drawn.width, drawn.height, 100, 60)
    expect(fit).toBeLessThan(1)
    expect(componentZoom(id).zoom).toBe(fit)
    expect(componentZoom(id).mode.kind).toBe('default')
    expect(scroller.style.getPropertyValue('--comp-w')).toBe(`${drawn.width * fit}px`)
    button('in').click()
    expect(componentZoom(id).zoom).toBe(stepZoom(fit, 1))
    expect(status()).toMatch(/^Zoom \d+%$/)
    runComponentZoom(scroller, 'reset')
    expect(componentZoom(id).zoom).toBe(fit)
    expect(componentZoom(id).mode.kind).toBe('default')
    expect(status()).toMatch(/^Default zoom, \d+%\. Too small to read: press Shift\+0\.$/)
  })

  it('never opens above 100%, however much room there is (#120)', () => {
    const { scroller, id } = view({ width: 5000, height: 5000 })
    bindComponentZoom(scroller)
    expect(componentZoom(id).zoom).toBe(1)
    expect(document.querySelector<HTMLElement>('.zoom-hint')!.hidden).toBe(true)
  })

  it('shows the too-small hint while the fit is below 100%, and not at a zoom of your own (#120)', () => {
    const { scroller } = view({ width: 100, height: 60 })
    bindComponentZoom(scroller)
    const hint = document.querySelector<HTMLElement>('.zoom-hint')!
    expect(hint.hidden).toBe(false)
    // Its own toolbar item, after the Zoom group, so a narrow row can give it a line (#120).
    expect(hint.previousElementSibling?.classList.contains('zoom-controls')).toBe(true)
    // Both wordings; zoom.css shows the touch one on a coarse pointer.
    expect(hint.querySelector('.zoom-hint-key')!.textContent).toBe('Too small to read: press Shift+0')
    expect(hint.querySelector('.zoom-hint-touch')!.textContent).toBe('Too small to read: tap 1:1')
    runComponentZoom(scroller, 'out')
    expect(hint.hidden).toBe(true)
    runComponentZoom(scroller, 'reset')
    expect(hint.hidden).toBe(false)
  })

  it('1:1 is a command named Actual size that sets 100%, as a zoom of your own (#120)', () => {
    const { scroller, id } = view({ width: 100, height: 60 })
    bindComponentZoom(scroller)
    const actual = button('actual')
    expect(actual.getAttribute('aria-label')).toBe('1:1 actual size, readable')
    expect(actual.getAttribute('title')).toBe('1:1 actual size, readable (Shift+0)')
    expect(actual.textContent).toBe('1:1')
    expect(actual.hasAttribute('aria-pressed')).toBe(false)
    // Overview is a mode, so it keeps aria-pressed; 1:1 is a plain command.
    expect(button('overview').getAttribute('aria-pressed')).toBe('false')
    // Next to Overview (the fit).
    expect(button('overview').nextElementSibling).toBe(actual)
    actual.click()
    expect(componentZoom(id).zoom).toBe(1)
    expect(componentZoom(id).mode.kind).toBe('zoomed')
    expect(status()).toBe('Zoom 1:1, 100%')
    // Pressed again: 100% still, said again.
    actual.click()
    expect(componentZoom(id).zoom).toBe(1)
    expect(actual.hasAttribute('aria-pressed')).toBe(false)
  })

  it('1:1 centres the selected link, else the busiest component on a fresh fit (#120)', () => {
    const s = scenario()
    s.participants.push({ id: 'c', name: 'Card', type: 'PARTICIPANT' })
    s.events.push({
      kind: 'message',
      id: 'm2',
      from: 'c',
      to: 'b',
      label: 'auth',
      type: 'SYNCHRONOUS',
    })
    const { scroller, id } = view({ width: 100, height: 60 }, s)
    bindComponentZoom(scroller)
    const fit = componentZoom(id).zoom
    const box = (left: number, top: number, width: number, height: number) => () =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect
    scroller.querySelector('.component-diagram')!.getBoundingClientRect = box(0, 0, 100, 60)
    const bank = [...scroller.querySelectorAll<SVGGElement>('.component-node')].find(
      (n) => n.dataset.component === 'b',
    )!
    bank.getBoundingClientRect = box(40 * fit, 20 * fit, 10 * fit, 10 * fit)
    runComponentZoom(scroller, 'actual')
    // The middle of Bank (the busiest: two links) at 45, 25 drawn px is in the middle of the room.
    expect(scroller.scrollLeft + 50).toBeCloseTo(45)
    expect(scroller.scrollTop + 30).toBeCloseTo(25)

    // A selected link wins over the busiest component.
    runComponentZoom(scroller, 'reset')
    const link = scroller.querySelector('.edge-group')!
    link.classList.add('is-selected')
    link.getBoundingClientRect = box(200 * fit, 100 * fit, 20 * fit, 20 * fit)
    runComponentZoom(scroller, 'actual')
    expect(scroller.scrollLeft + 50).toBeCloseTo(210)
    expect(scroller.scrollTop + 30).toBeCloseTo(110)
  })

  it('a click or tap on a fit too small to read goes to 1:1 there, not to what is under it (#120)', () => {
    const { scroller, id } = view({ width: 100, height: 60 })
    bindComponentZoom(scroller)
    const fit = componentZoom(id).zoom
    expect(fit).toBeLessThan(1)
    expect(componentZoom(id).mode.kind).toBe('default')
    let opened = 0
    bindComponentViews(document, () => opened++)
    scroller.querySelector('.component-diagram')!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60 }) as DOMRect
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 30 * fit, clientY: 20 * fit })
    scroller.querySelector('.edge-group')!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(opened).toBe(0)
    expect(componentZoom(id).zoom).toBe(1)
    expect(componentZoom(id).mode.kind).toBe('zoomed')
    // The point clicked, 30, 20 drawn px, is in the middle of the room.
    expect(scroller.scrollLeft + 50).toBeCloseTo(30)
    expect(scroller.scrollTop + 30).toBeCloseTo(20)
    // At 1:1 a click is the link's again.
    scroller.querySelector('.edge-group')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(opened).toBe(1)
  })

  it('Enter or Space on a link in a fit too small to read goes to 1:1 on it, not to the side panel (#120)', () => {
    const { scroller, id } = view({ width: 100, height: 60 })
    bindComponentZoom(scroller)
    let opened = 0
    bindComponentViews(document, () => opened++)
    const link = scroller.querySelector<SVGGElement>('.edge-group')!
    link.focus()
    const enter = press(link, 'Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(opened).toBe(0)
    expect(componentZoom(id).zoom).toBe(1)
    expect(status()).toBe('Zoom 1:1, 100%')
    // Readable now: Enter opens the link.
    press(link, 'Enter')
    expect(opened).toBe(1)
    // From the fit again, Space too.
    runComponentZoom(scroller, 'reset')
    expect(press(link, ' ').defaultPrevented).toBe(true)
    expect(opened).toBe(1)
    expect(componentZoom(id).zoom).toBe(1)
  })

  it('on touch, the too-small fit says to tap 1:1, in the status line and the view switch (#120)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', media: query }))
    try {
      const { scroller, id } = view({ width: 100, height: 60 })
      bindComponentZoom(scroller)
      runComponentZoom(scroller, 'reset')
      expect(status()).toMatch(/^Default zoom, \d+%\. Too small to read: tap 1:1\.$/)
      expect(componentTooSmallSaid(id)).toBe('. Too small to read: tap 1:1.')
      runComponentZoom(scroller, 'actual')
      expect(componentTooSmallSaid(id)).toBe('')
    } finally {
      vi.unstubAllGlobals()
      vi.stubGlobal('ResizeObserver', FakeObserver)
    }
  })

  it('the side panel opening never shrinks the default view; closing it finds the same zoom (#120)', () => {
    const { scroller, id } = view({ width: 100, height: 60 })
    bindComponentZoom(scroller)
    const fit = componentZoom(id).zoom
    const shell = document.querySelector('.shell')!
    const resize = (width: number) => {
      setRoom(scroller, { width, height: 60 })
      for (const o of observers) if (o.watched.has(scroller)) o.fire(scroller)
    }
    // The panel opens and the room narrows: the zoom holds.
    shell.classList.add('with-inspector')
    resize(20)
    expect(componentZoom(id).zoom).toBe(fit)
    expect(componentZoom(id).mode.kind).toBe('default')
    // It closes: the same room as the fit, the same zoom.
    shell.classList.remove('with-inspector')
    resize(100)
    expect(componentZoom(id).zoom).toBe(fit)
    // Without the panel a narrower room fits smaller, as before.
    resize(20)
    expect(componentZoom(id).zoom).toBeLessThan(fit)
  })

  it('a zoom of your own is kept when the view is drawn again, and the default does not replace it (#120)', () => {
    const s = scenario()
    const first = view({ width: 100, height: 60 }, s)
    bindComponentZoom(first.scroller)
    runComponentZoom(first.scroller, 'actual')
    const again = view({ width: 100, height: 60 }, s)
    bindComponentZoom(again.scroller)
    expect(componentZoom(s.id).zoom).toBe(1)
    expect(componentZoom(s.id).mode.kind).toBe('zoomed')
  })

  it('Overview fits from a zoom of your own, Esc or Overview again goes back, and a click in it goes to 1:1', () => {
    const { scroller, id } = view({ width: 40, height: 30 })
    bindComponentZoom(scroller)
    // The default view already fits the whole graph: nothing for Overview to do.
    expect(button('overview').getAttribute('aria-disabled')).toBe('true')
    runComponentZoom(scroller, 'actual')
    expect(button('overview').getAttribute('aria-disabled')).toBeNull()
    runComponentZoom(scroller, 'overview')
    const state = componentZoom(id)
    expect(state.mode).toMatchObject({
      kind: 'overview',
      saved: { zoom: 1, mode: { kind: 'zoomed' } },
    })
    expect(state.zoom).toBeLessThan(1)
    expect(button('overview').getAttribute('aria-pressed')).toBe('true')
    // On, it stays enabled: a mode, not "dimmed" to a screen reader.
    expect(button('overview').getAttribute('aria-disabled')).toBeNull()
    expect(status()).toMatch(/^Overview, \d+%/)
    // Pressed again it goes back.
    runComponentZoom(scroller, 'overview')
    expect(inOverview(id)).toBe(false)
    expect(state.zoom).toBe(1)
    runComponentZoom(scroller, 'overview')
    runComponentZoom(scroller, 'leave')
    expect(inOverview(id)).toBe(false)
    expect(state.zoom).toBe(1)
    expect(status()).toBe('Overview off, zoom 100%')
    runComponentZoom(scroller, 'leave')
    expect(state.zoom).toBe(1)

    // + from Overview leaves it without going back.
    runComponentZoom(scroller, 'overview')
    runComponentZoom(scroller, 'in')
    expect(inOverview(id)).toBe(false)
    expect(status()).toMatch(/^Overview off, zoom/)

    runComponentZoom(scroller, 'actual')
    runComponentZoom(scroller, 'overview')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
    scroller.querySelector('svg')!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(inOverview(id)).toBe(false)
    expect(state.zoom).toBe(1)
    expect(status()).toBe('Zoom 1:1, 100%')
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
    const fit = componentZoom(id).zoom
    scroller.dispatchEvent(wheelOf(false))
    expect(componentZoom(id).zoom).toBe(fit)
    const wheel = wheelOf(true)
    scroller.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(componentZoom(id).zoom).toBe(stepZoom(fit, -1))
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
    // The default view fits again too (#120).
    const opened = componentZoom(id).zoom
    setRoom(scroller, { width: 5, height: 30 })
    observer.fire(scroller)
    expect(componentZoom(id).zoom).toBeLessThan(opened)
    expect(componentZoom(id).mode.kind).toBe('default')
    runComponentZoom(scroller, 'actual')
    setRoom(scroller, { width: 40, height: 30 })
    observer.fire(scroller)
    expect(componentZoom(id).zoom).toBe(1)
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
    runComponentZoom(scroller, 'actual')
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
    runComponentZoom(scroller, 'actual')
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
    const fit = componentZoom(id).zoom
    expect(press(link, '+').defaultPrevented).toBe(true)
    expect(componentZoom(id).zoom).toBe(stepZoom(fit, 1))
    press(link, '0')
    expect(componentZoom(id).zoom).toBe(fit)
    expect(press(link, 'Escape').defaultPrevented, 'Esc out of Overview is not the view’s').toBe(false)
    // Shift+0 is 1:1 (#120), on US and UK layouts alike.
    expect(press(link, ')', { shiftKey: true, code: 'Digit0' }).defaultPrevented).toBe(true)
    expect(componentZoom(id).zoom).toBe(1)
    expect(componentZoom(id).mode.kind).toBe('zoomed')
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
