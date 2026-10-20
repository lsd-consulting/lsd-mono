// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { Participant, Scenario } from '../../types'
import { SINGLE_KEYS_KEY } from '../../ui/shortcuts'
import { bindDiagramScroll, diagramView, renderDiagramHtml, syncDiagramWindow } from '../sequence-diagram'
import { onZoomKey, zoomKeyAction } from './zoom-controls'

let n = 0
/** A fresh scenario per test, [lanes] wide: views live per scenario id for the page's life. */
function scenario(lanes: number): Scenario {
  n++
  const participants: Participant[] = Array.from({ length: lanes }, (_, i) => ({
    id: `p${i}`,
    name: `Service ${i}`,
    type: 'PARTICIPANT',
  }))
  return {
    id: `zoom-${n}`,
    title: 'Zoom',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants,
    events: participants.slice(1).map((p, i) => ({
      kind: 'message',
      id: `m${i}`,
      from: 'p0',
      to: p.id,
      label: `call ${i}`,
      type: 'SYNCHRONOUS',
      // A payload, so each arrow has a button to focus.
      data: { body: { n: i } },
    })),
  }
}

/** Mount a diagram in a scrollport [width] px wide. */
function mount(lanes = 12, width = 600) {
  const s = scenario(lanes)
  const host = document.createElement('div')
  host.innerHTML = renderDiagramHtml(s)
  document.body.append(host)
  const scroll = host.querySelector<HTMLElement>('.seq-scroll')!
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 })
  Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: width })
  bindDiagramScroll(host)
  syncDiagramWindow(scroll)
  const root = host.querySelector<HTMLElement>('.seq-diagram')!
  const button = (zoom: string) => root.querySelector<HTMLButtonElement>(`[data-zoom="${zoom}"]`)!
  return {
    s,
    root,
    scroll,
    view: () => diagramView(s.id),
    button,
    readout: () => button('reset').textContent,
    status: () => root.querySelector('.participant-filter-status')!.textContent,
  }
}

const press = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  el.dispatchEvent(ev)
  return ev
}

/** What chrome.ts does with keys in the main column: zoom first. */
const onMainKey = (ev: Event) => onZoomKey(ev as KeyboardEvent)
document.addEventListener('keydown', onMainKey)

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.removeItem(SINGLE_KEYS_KEY)
})

describe('zoom controls markup (#94)', () => {
  it('has, in order, Zoom out, Reset zoom (with the level), Zoom in and Overview, and no Fit', () => {
    const { root } = mount()
    const group = root.querySelector('.zoom-controls[role="group"][aria-label="Zoom"]')!
    const buttons = [...group.querySelectorAll('button')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Zoom out',
      `Reset zoom, now ${buttons[1].textContent}`,
      'Zoom in',
      'Overview',
    ])
    expect(buttons.map((b) => b.title)).toEqual([
      'Zoom out (−)',
      'Reset to default zoom (0)',
      'Zoom in (+)',
      'Overview: whole diagram (Shift+1)',
    ])
    expect(buttons[3].getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('.seq-toolbar')!.innerHTML).not.toMatch(/\bFit\b/)
  })

  it('draws + and − as strokes and Overview as the Lucide scan brackets, all in currentColor', () => {
    const { button } = mount()
    const paths = (zoom: string) => [...button(zoom).querySelectorAll('svg path')].map((p) => p.getAttribute('d'))
    expect(paths('out')).toEqual(['M5 12h14'])
    expect(paths('in')).toEqual(['M5 12h14', 'M12 5v14'])
    expect(paths('overview')).toEqual([
      'M3 7V5a2 2 0 0 1 2-2h2',
      'M17 3h2a2 2 0 0 1 2 2v2',
      'M21 17v2a2 2 0 0 1-2 2h-2',
      'M7 21H5a2 2 0 0 1-2-2v-2',
    ])
    for (const zoom of ['out', 'in', 'overview']) {
      const svg = button(zoom).querySelector('svg')!
      expect(svg.getAttribute('stroke')).toBe('currentColor')
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

describe('zoom buttons (#94)', () => {
  it('goes from 95% to 100% on +, and from 100% to 90% on −, announcing each once', () => {
    const z = mount()
    z.view().zoom = 0.95
    z.button('in').click()
    expect(z.readout()).toBe('100%')
    expect(z.button('reset').getAttribute('aria-label')).toBe('Reset zoom, now 100%')
    expect(z.status()).toBe('Zoom 100%')
    z.button('out').click()
    expect(z.readout()).toBe('90%')
    expect(z.status()).toBe('Zoom 90%')
  })

  it('stops at 250% with Zoom in disabled, and at 25% with Zoom out disabled', () => {
    const z = mount()
    for (let i = 0; i < 20; i++) z.button('in').click()
    expect(z.readout()).toBe('250%')
    expect(z.button('in').getAttribute('aria-disabled')).toBe('true')
    z.root.querySelector('.participant-filter-status')!.textContent = ''
    z.button('in').click()
    expect(z.readout()).toBe('250%')
    expect(z.status()).toBe('')
    for (let i = 0; i < 20; i++) z.button('out').click()
    expect(z.readout()).toBe('25%')
    expect(z.button('out').getAttribute('aria-disabled')).toBe('true')
    expect(z.button('in').hasAttribute('aria-disabled')).toBe(false)
  })

  it('goes back to the default view from the % readout, never above 100% for a narrow diagram', () => {
    const z = mount(3, 1400)
    z.button('in').click()
    z.button('in').click()
    expect(z.view().autoFit).toBe(false)
    z.button('reset').click()
    expect(z.readout()).toBe('100%')
    expect(z.view().autoFit).toBe(true)
    expect(z.status()).toBe('Default zoom, 100%')
  })
})

describe('Overview (#94)', () => {
  it('fits the whole width, says so, and goes back to the view from before when pressed again', () => {
    const z = mount(12, 600)
    z.view().zoom = 1.25
    z.scroll.scrollTop = 120
    z.button('overview').click()
    expect(z.button('overview').getAttribute('aria-pressed')).toBe('true')
    expect(z.view().zoom).toBeLessThan(0.95)
    expect(z.status()).toMatch(/^Overview, \d+%, whole diagram$/)
    z.button('overview').click()
    expect(z.button('overview').getAttribute('aria-pressed')).toBe('false')
    expect(z.view().zoom).toBe(1.25)
    expect(z.status()).toBe('Overview off, zoom 125%')
  })

  it('stops at 10% and counts the lanes it shows when the whole width cannot fit', () => {
    const z = mount(100, 600)
    z.button('overview').click()
    expect(z.readout()).toBe('10%')
    expect(z.status()).toMatch(/^Overview, 10%, (\d+) of 100 lanes shown$/)
    const shown = Number(/(\d+) of/.exec(z.status() ?? '')![1])
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(100)
  })

  it('is disabled with its reason when the whole diagram already fits', () => {
    const z = mount(3, 1400)
    expect(z.button('overview').getAttribute('aria-disabled')).toBe('true')
    expect(z.button('overview').title).toBe('Whole diagram already fits')
    z.button('overview').click()
    expect(z.button('overview').getAttribute('aria-pressed')).toBe('false')
  })

  it('leaves for the default view centred on an arrow when Enter is pressed on it', () => {
    const z = mount(12, 600)
    z.button('overview').click()
    const arrow = z.root.querySelector<HTMLButtonElement>('button.msg-open')!
    arrow.focus()
    const ev = press(arrow, 'Enter')
    expect(ev.defaultPrevented).toBe(true)
    expect(z.button('overview').getAttribute('aria-pressed')).toBe('false')
    expect(z.status()).toMatch(/^Default zoom, \d+%$/)
  })

  it('leaves for the default view when the drawing is clicked, without opening what is under it', () => {
    const z = mount(12, 600)
    z.button('overview').click()
    let reached = false
    document.body.addEventListener('click', () => (reached = true), { once: true })
    z.root.querySelector('.seq-window')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(reached).toBe(false)
    expect(z.button('overview').getAttribute('aria-pressed')).toBe('false')
    expect(z.view().autoFit).toBe(true)
  })

  it('stays on, fitted to the lanes left, when a participant is hidden', () => {
    const z = mount(100, 600)
    z.button('overview').click()
    const head = z.root.querySelector('[data-participant-head="p5"]')!
    head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    head.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    z.root.querySelector<HTMLButtonElement>('[data-hide-participant="p5"]')!.click()
    expect(z.button('overview').getAttribute('aria-pressed')).toBe('true')
    expect(z.view().overview).not.toBeNull()
  })
})

describe('zoom keys (#94)', () => {
  it('maps + and =, -, 0, Shift+1 (by key position) and Esc in Overview', () => {
    const on = { singleKeys: true, overview: false }
    const key = (k: string, init: Partial<KeyboardEvent> = {}) =>
      ({ key: k, code: '', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...init }) as KeyboardEvent
    expect(zoomKeyAction(key('+', { shiftKey: true }), on)).toBe('in')
    expect(zoomKeyAction(key('='), on)).toBe('in')
    expect(zoomKeyAction(key('-'), on)).toBe('out')
    expect(zoomKeyAction(key('0'), on)).toBe('reset')
    expect(zoomKeyAction(key('!', { shiftKey: true, code: 'Digit1' }), on)).toBe('overview')
    // AZERTY: Shift on the 1 key is "1".
    expect(zoomKeyAction(key('1', { shiftKey: true, code: 'Digit1' }), on)).toBe('overview')
    expect(zoomKeyAction(key('Escape'), on)).toBeNull()
    expect(zoomKeyAction(key('Escape'), { ...on, overview: true })).toBe('leave')
  })

  it('leaves Ctrl/Cmd with them to the browser, and the character keys alone when shortcuts are off', () => {
    const key = (k: string, init: Partial<KeyboardEvent> = {}) =>
      ({ key: k, code: '', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...init }) as KeyboardEvent
    for (const k of ['+', '=', '-', '0']) {
      expect(zoomKeyAction(key(k, { ctrlKey: true }), { singleKeys: true, overview: false })).toBeNull()
      expect(zoomKeyAction(key(k, { metaKey: true }), { singleKeys: true, overview: false })).toBeNull()
      expect(zoomKeyAction(key(k), { singleKeys: false, overview: false })).toBeNull()
    }
    expect(
      zoomKeyAction(key('!', { shiftKey: true, code: 'Digit1' }), { singleKeys: false, overview: false }),
    ).toBeNull()
    expect(zoomKeyAction(key('Escape'), { singleKeys: false, overview: true })).toBe('leave')
  })

  it('zooms from a focused arrow, does nothing in Find, and nothing with shortcuts off', () => {
    const z = mount()
    z.view().zoom = 0.95
    const arrow = z.root.querySelector<HTMLButtonElement>('button.msg-open')!
    expect(press(arrow, '+', { shiftKey: true }).defaultPrevented).toBe(true)
    expect(z.readout()).toBe('100%')
    const find = z.root.querySelector<HTMLInputElement>('[data-diagram-find]')!
    expect(press(find, '+').defaultPrevented).toBe(false)
    expect(z.readout()).toBe('100%')
    localStorage.setItem(SINGLE_KEYS_KEY, 'off')
    expect(press(arrow, '-').defaultPrevented).toBe(false)
    expect(z.readout()).toBe('100%')
    // The buttons still work.
    z.button('out').click()
    expect(z.readout()).toBe('90%')
  })

  it('does nothing outside a diagram card, and lets Ctrl+= through', () => {
    const z = mount()
    const before = z.view().zoom
    const outside = document.body.appendChild(document.createElement('button'))
    expect(press(outside, '+').defaultPrevented).toBe(false)
    const arrow = z.root.querySelector<HTMLButtonElement>('button.msg-open')!
    expect(press(arrow, '=', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(arrow, '0', { metaKey: true }).defaultPrevented).toBe(false)
    expect(z.view().zoom).toBe(before)
  })

  it('toggles Overview with Shift+1 and leaves it with Esc', () => {
    const z = mount(12, 600)
    const arrow = z.root.querySelector<HTMLButtonElement>('button.msg-open')!
    press(arrow, '!', { shiftKey: true, code: 'Digit1' })
    expect(z.button('overview').getAttribute('aria-pressed')).toBe('true')
    const esc = press(z.scroll, 'Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(z.button('overview').getAttribute('aria-pressed')).toBe('false')
    // Not in Overview, Esc is the page's.
    expect(press(z.scroll, 'Escape').defaultPrevented).toBe(false)
  })
})
