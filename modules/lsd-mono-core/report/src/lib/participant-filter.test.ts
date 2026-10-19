// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Scenario } from '../types'
import {
  allBut,
  COMPACT_HEADER_PX,
  filterStatusText,
  headActionsHtml,
  headSlots,
  hiddenFilterHtml,
  hiddenInOrder,
  LONG_PRESS_MS,
  participantMenuHtml,
  PILL_W,
} from './participant-filter'
import { bindDiagramScroll, diagramView, renderDiagramHtml, syncDiagramWindow } from './sequence-diagram'

let n = 0
/** A fresh scenario id per test: hidden state lives per scenario for the page's life. */
function scenario(): Scenario {
  n++
  return {
    id: `filter-${n}`,
    title: 'Filter',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants: [
      { id: 'client', name: 'Client', type: 'ACTOR' },
      { id: 'api', name: 'Api', type: 'PARTICIPANT' },
      { id: 'db', name: 'Orders DB', type: 'DATABASE' },
      { id: 'bus', name: 'Bus', alias: 'Order events', type: 'QUEUE' },
    ],
    events: [
      { kind: 'message', id: 'm1', from: 'client', to: 'api', label: 'place order', type: 'SYNCHRONOUS' },
      { kind: 'message', id: 'm2', from: 'api', to: 'db', label: 'insert', type: 'SYNCHRONOUS' },
      { kind: 'message', id: 'm3', from: 'api', to: 'bus', label: 'publish', type: 'ASYNCHRONOUS' },
      { kind: 'note', id: 'n1', text: 'over the bus', over: 'bus', placement: 'over' },
    ],
  }
}

function mount(s: Scenario = scenario()): { s: Scenario; root: HTMLElement; scroll: HTMLElement } {
  const host = document.createElement('div')
  host.innerHTML = renderDiagramHtml(s)
  document.body.append(host)
  const scroll = host.querySelector<HTMLElement>('.seq-scroll')!
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 })
  bindDiagramScroll(host)
  syncDiagramWindow(scroll)
  return { s, root: host.querySelector<HTMLElement>('.seq-diagram')!, scroll }
}

const headIds = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-participant-head]')].map((el) => el.dataset.participantHead)
const chip = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-hidden-chip]')
const status = (root: HTMLElement) => root.querySelector('.participant-filter-status')!.textContent
/** A pointer pressed on [id]'s header brings the one set of buttons there; its Hide. */
const hideBtn = (root: HTMLElement, id: string) => {
  const head = root.querySelector(`[data-participant-head="${id}"]`)!
  head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  head.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  return root.querySelector<HTMLButtonElement>(`[data-hide-participant="${id}"]`)!
}
const labels = (root: HTMLElement) => [...root.querySelectorAll('.msg-label > title')].map((el) => el.textContent)
const press = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('participant filter markup', () => {
  it('splits the header at the midpoints between lifelines', () => {
    const slots = headSlots(
      [
        { id: 'a', name: 'A', typeLabel: 'actor', x: 50 },
        { id: 'b', name: 'B', typeLabel: 'component', x: 150 },
        { id: 'c', name: 'C', typeLabel: 'database', x: 350 },
      ],
      420,
    )
    expect(slots.map((s) => [s.left, s.width])).toEqual([
      [0, 100],
      [100, 150],
      [250, 170],
    ])
    // The pill is centred on the lifeline, inside the header: x 50 -> 23..77, x 350 -> 323..377.
    expect(slots.map((s) => s.left + s.pillX)).toEqual([23, 123, 323])
    const edge = headSlots([{ id: 'z', name: 'Z', typeLabel: 'actor', x: 395 }], 420)
    expect(edge[0].pillX + PILL_W).toBe(420)
    const start = headSlots([{ id: 'z', name: 'Z', typeLabel: 'actor', x: 5 }], 420)
    expect(start[0].pillX).toBe(0)
  })

  it('gives the header row one tab stop and names every button', () => {
    const slots = headSlots(
      [
        { id: 'a', name: 'Alpha', typeLabel: 'actor', x: 40 },
        { id: 'b', name: 'Beta <b>', typeLabel: 'queue', x: 120 },
      ],
      200,
    )
    const host = document.createElement('div')
    host.innerHTML = headActionsHtml(slots, 56, 'more:b')
    // One set of buttons, on the header with the tab stop (#62).
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Hide Beta <b>', 'More actions for Beta <b>'])
    expect(buttons.map((b) => b.tabIndex)).toEqual([-1, 0])
    expect(host.querySelector('[data-participant-head="a"]')!.children).toHaveLength(0)
    expect(host.querySelector<HTMLElement>('[data-participant-head="b"]')!.dataset.name).toBe('Beta <b>')
    expect(host.querySelector('[data-participant-head="b"]')!.getAttribute('title')).toBe('Beta <b>, queue')
    expect(host.querySelector('.participant-heads')!.hasAttribute('data-compact')).toBe(false)
    host.innerHTML = headActionsHtml(slots, COMPACT_HEADER_PX - 1, null)
    expect(host.querySelector('.participant-heads')!.hasAttribute('data-compact')).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('[data-hide-participant="a"]')!.tabIndex).toBe(0)
  })

  it('draws no chip while nothing is hidden, and lists hidden participants in diagram order', () => {
    const s = scenario()
    expect(hiddenFilterHtml(s.id, [], false)).toBe('')
    const hidden = hiddenInOrder(s.participants, new Set(['bus', 'client']))
    expect(hidden.map((p) => p.id)).toEqual(['client', 'bus'])
    const host = document.createElement('div')
    host.innerHTML = hiddenFilterHtml(s.id, hidden, false)
    expect(host.querySelector('[data-hidden-chip]')!.textContent).toBe('2 hidden')
    expect(host.querySelector('[data-hidden-chip]')!.getAttribute('aria-label')).toBe('2 hidden participants')
    expect(host.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(true)
    expect([...host.querySelectorAll('[data-show-participant]')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Show Client',
      'Show Order events',
    ])
  })

  it('marks menu items that cannot apply as disabled', () => {
    const host = document.createElement('div')
    host.innerHTML = participantMenuHtml({ name: 'Api', canHideOthers: false, anyHidden: false })
    expect(
      [...host.querySelectorAll('[role="menuitem"]')].map((i) => [i.textContent, i.getAttribute('aria-disabled')]),
    ).toEqual([
      ['Hide all but Api', 'true'],
      ['Hide Api', null],
      ['Show all', 'true'],
    ])
  })

  it('hides everything but one participant', () => {
    expect([...allBut(scenario().participants, 'api')]).toEqual(['client', 'db', 'bus'])
    expect(filterStatusText('Api shown', 0)).toBe('Api shown. All participants shown.')
    expect(filterStatusText('Bus hidden', 2)).toBe('Bus hidden. 2 hidden.')
  })
})

describe('participant filter in the diagram', () => {
  it('has no show/hide button row; each header has Hide and More instead', () => {
    const { root } = mount()
    expect(root.querySelector('[data-participant-toggle]')).toBeNull()
    expect(root.querySelector('.participant-toggles')).toBeNull()
    expect(chip(root)).toBeNull()
    expect(headIds(root)).toEqual(['client', 'api', 'db', 'bus'])
    expect(hideBtn(root, 'bus').getAttribute('aria-label')).toBe('Hide Order events')
    expect(root.querySelectorAll('.participant-heads button[tabindex="0"]')).toHaveLength(1)
  })

  it('hides from the header ×: drops the column and its messages, shows the chip, and moves focus on', () => {
    const { s, root } = mount()
    hideBtn(root, 'db').focus()
    hideBtn(root, 'db').click()
    expect(headIds(root)).toEqual(['client', 'api', 'bus'])
    expect([...diagramView(s.id).hidden]).toEqual(['db'])
    // As before #8: a message or note that needs a hidden column is left out; the rest stay.
    expect(labels(root)).toEqual(['place order', 'publish'])
    expect(root.querySelector('.note-text')).not.toBeNull()
    expect(chip(root)!.textContent).toBe('1 hidden')
    expect(status(root)).toBe('Orders DB hidden. 1 hidden.')
    expect(document.activeElement).toBe(hideBtn(root, 'bus'))
    expect(hideBtn(root, 'bus').tabIndex).toBe(0)
  })

  it('moves focus to the chip when the last participant is hidden', () => {
    const { root } = mount()
    expect(labels(root)).toEqual(['place order', 'insert', 'publish'])
    for (const id of ['client', 'api', 'db', 'bus']) hideBtn(root, id).click()
    expect(labels(root)).toEqual([])
    expect(headIds(root)).toEqual([])
    expect(chip(root)!.textContent).toBe('4 hidden')
    expect(document.activeElement).toBe(chip(root))
  })

  it('opens the hidden list from the chip, shows one, closes on Escape and gives focus back', () => {
    const { s, root } = mount()
    hideBtn(root, 'db').click()
    hideBtn(root, 'bus').click()
    chip(root)!.click()
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.hidden).toBe(false)
    expect(chip(root)!.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show Orders DB')
    ;(document.activeElement as HTMLButtonElement).click()
    expect([...diagramView(s.id).hidden]).toEqual(['bus'])
    expect(status(root)).toBe('Orders DB shown. 1 hidden.')
    // The list stays open on the next hidden participant.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show Order events')
    press(document.activeElement!, 'Escape')
    expect(root.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(true)
    expect(document.activeElement).toBe(chip(root))
  })

  it('Escape in the hidden list does not reach the page (the side panel stays open)', () => {
    const { root } = mount()
    hideBtn(root, 'db').click()
    chip(root)!.click()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    press(document.activeElement!, 'Escape')
    document.removeEventListener('keydown', outer)
    expect(outer).not.toHaveBeenCalled()
  })

  it('removes the chip once the last one is shown, and focuses its header', () => {
    const { root } = mount()
    hideBtn(root, 'api').click()
    chip(root)!.click()
    root.querySelector<HTMLButtonElement>('[data-show-participant="api"]')!.click()
    expect(chip(root)).toBeNull()
    expect(root.querySelector('[data-participant-filter]')!.innerHTML).toBe('')
    expect(headIds(root)).toEqual(['client', 'api', 'db', 'bus'])
    expect(document.activeElement).toBe(hideBtn(root, 'api'))
    expect(status(root)).toBe('Api shown. All participants shown.')
  })

  it('Show all brings every participant back', () => {
    const { s, root } = mount()
    hideBtn(root, 'api').click()
    hideBtn(root, 'bus').click()
    chip(root)!.click()
    root.querySelector<HTMLButtonElement>('[data-show-all]')!.click()
    expect(diagramView(s.id).hidden.size).toBe(0)
    expect(chip(root)).toBeNull()
    expect(document.activeElement).toBe(hideBtn(root, 'client'))
  })

  it('right-click on a header offers Hide all but this one', () => {
    const { s, root } = mount()
    const head = root.querySelector('[data-participant-head="api"]')!
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 20 })
    head.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    const menu = root.querySelector<HTMLElement>('.participant-menu')!
    expect(menu.hidden).toBe(false)
    expect(menu.getAttribute('role')).toBe('menu')
    expect(menu.getAttribute('aria-label')).toBe('Actions for Api')
    expect(document.activeElement?.textContent).toBe('Hide all but Api')
    expect(menu.querySelector('[data-menu-action="show-all"]')!.getAttribute('aria-disabled')).toBe('true')
    ;(document.activeElement as HTMLButtonElement).click()
    expect([...diagramView(s.id).hidden].sort()).toEqual(['bus', 'client', 'db'])
    expect(menu.hidden).toBe(true)
    expect(headIds(root)).toEqual(['api'])
    expect(chip(root)!.textContent).toBe('3 hidden')
    expect(status(root)).toBe('Only Api shown. 3 hidden.')
    expect(document.activeElement).toBe(hideBtn(root, 'api'))
  })

  it('reaches the menu from the keyboard: Shift+F10 or the context-menu key, arrows, Escape', () => {
    const { s, root } = mount()
    const first = hideBtn(root, 'client')
    first.focus()
    press(first, 'ArrowRight')
    const more = root.querySelector<HTMLButtonElement>('[data-participant-menu="client"]')!
    expect(document.activeElement).toBe(more)
    expect(more.tabIndex).toBe(0)
    expect(first.tabIndex).toBe(-1)
    press(more, 'End')
    expect(document.activeElement).toBe(root.querySelector('[data-participant-menu="bus"]'))
    press(document.activeElement!, 'Home')
    expect(document.activeElement).toBe(first)

    press(first, 'F10', { shiftKey: true })
    const menu = root.querySelector<HTMLElement>('.participant-menu')!
    expect(menu.hidden).toBe(false)
    press(document.activeElement!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('Hide Client')
    press(document.activeElement!, 'Escape')
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(first)

    more.click()
    expect(menu.hidden).toBe(false)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    press(document.activeElement!, 'Escape')
    expect(document.activeElement).toBe(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')

    press(hideBtn(root, 'db'), 'ContextMenu')
    expect(menu.getAttribute('aria-label')).toBe('Actions for Orders DB')
    press(document.activeElement!, 'ArrowUp')
    press(document.activeElement!, 'ArrowUp')
    expect(document.activeElement?.textContent).toBe('Hide Orders DB')
    ;(document.activeElement as HTMLButtonElement).click()
    expect([...diagramView(s.id).hidden]).toEqual(['db'])
  })

  it('Delete on a header button hides that participant', () => {
    const { s, root } = mount()
    press(hideBtn(root, 'api'), 'Delete')
    expect([...diagramView(s.id).hidden]).toEqual(['api'])
  })

  it('a long press on a touch screen opens the menu, and the lifted finger does not hide', () => {
    vi.useFakeTimers()
    const { s, root } = mount()
    const head = root.querySelector('[data-participant-head="db"]')!
    head.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 10, clientY: 10 }),
    )
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    const menu = root.querySelector<HTMLElement>('.participant-menu')!
    expect(menu.hidden).toBe(false)
    expect(menu.getAttribute('aria-label')).toBe('Actions for Orders DB')
    head.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
    // The long press put the buttons on its header; the lifted finger's click lands on its Hide.
    root.querySelector('[data-hide-participant="db"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(diagramView(s.id).hidden.size).toBe(0)
  })

  it('a moving finger is a scroll, not a long press', () => {
    vi.useFakeTimers()
    const { root } = mount()
    const head = root.querySelector('[data-participant-head="db"]')!
    head.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: 10, clientY: 10 }),
    )
    head.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: 40, clientY: 10 }),
    )
    vi.advanceTimersByTime(LONG_PRESS_MS + 10)
    expect(root.querySelector<HTMLElement>('.participant-menu')!.hidden).toBe(true)
  })

  it('a tap on a header reveals its buttons; a tap elsewhere hides them', () => {
    const { root } = mount()
    const head = root.querySelector<HTMLElement>('[data-participant-head="api"]')!
    head.click()
    expect(head.hasAttribute('data-revealed')).toBe(true)
    root.querySelector<HTMLElement>('[data-participant-head="db"]')!.click()
    expect(head.hasAttribute('data-revealed')).toBe(false)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(root.querySelector('[data-revealed]')).toBeNull()
  })

  it('a press outside closes the menu and the hidden list', () => {
    const { root } = mount()
    hideBtn(root, 'db').click()
    chip(root)!.click()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(root.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(true)
    root.querySelector('[data-participant-head="api"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    expect(root.querySelector<HTMLElement>('.participant-menu')!.hidden).toBe(false)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(root.querySelector<HTMLElement>('.participant-menu')!.hidden).toBe(true)
  })

  it('keeps hidden participants per scenario, across a re-render', () => {
    const a = mount()
    const b = mount()
    hideBtn(a.root, 'bus').click()
    expect(headIds(b.root)).toEqual(['client', 'api', 'db', 'bus'])
    expect(chip(b.root)).toBeNull()
    document.body.innerHTML = ''
    const again = mount(a.s)
    expect(headIds(again.root)).toEqual(['client', 'api', 'db'])
    expect(chip(again.root)!.textContent).toBe('1 hidden')
  })

  it('keeps the header tab stop and focus when zoom redraws the header', () => {
    const { root } = mount()
    const db = hideBtn(root, 'db')
    db.focus()
    root.querySelector<HTMLButtonElement>('[data-zoom="in"]')!.click()
    db.focus()
    root.querySelector<HTMLButtonElement>('[data-zoom="out"]')!.click()
    expect(hideBtn(root, 'db').tabIndex).toBe(0)
  })

  it('counts find hits on a hidden column', () => {
    const { root } = mount()
    const find = root.querySelector<HTMLInputElement>('[data-diagram-find]')!
    hideBtn(root, 'db').click()
    find.value = 'insert'
    find.dispatchEvent(new Event('input'))
    expect(root.querySelector('.diagram-find-count')!.textContent).toContain('1 on a hidden column')
  })

  it('keeps keyboard focus on its participant when a pointer passes over another header', () => {
    const { s, root } = mount()
    const hover = (id: string) =>
      root
        .querySelector(`[data-participant-head="${id}"]`)!
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    hover('client')
    const hide = root.querySelector<HTMLButtonElement>('[data-hide-participant="client"]')!
    hide.focus()
    press(hide, 'Tab')
    hover('db')
    expect(document.activeElement).toBe(hide)
    expect(hide.dataset.hideParticipant).toBe('client')
    expect(hide.getAttribute('aria-label')).toBe('Hide Client')
    press(hide, 'Enter')
    hide.click()
    expect([...diagramView(s.id).hidden]).toEqual(['client'])
  })

  it('still follows the pointer once a pointer has pressed in the header', () => {
    const { root } = mount()
    const head = (id: string) => root.querySelector(`[data-participant-head="${id}"]`)!
    head('client').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    const hide = root.querySelector<HTMLButtonElement>('[data-hide-participant="client"]')!
    head('client').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    hide.focus()
    head('db').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    expect(hide.dataset.hideParticipant).toBe('db')
    expect(hide.getAttribute('aria-label')).toBe('Hide Orders DB')
  })

  it('forgets a press on a header name once a key is pressed outside it (Tab in from the page)', () => {
    const { root } = mount()
    const head = (id: string) => root.querySelector(`[data-participant-head="${id}"]`)!
    head('client').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    // A click on the name: no focus moves into the header.
    head('client').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    const hide = root.querySelector<HTMLButtonElement>('[data-hide-participant="client"]')!
    hide.focus()
    head('db').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    expect(document.activeElement).toBe(hide)
    expect(hide.getAttribute('aria-label')).toBe('Hide Client')
  })

  it('moves the one set of buttons to the header in use, renamed, and keeps the tab stop with it', () => {
    const { root } = mount()
    expect(root.querySelectorAll('.participant-heads button')).toHaveLength(2)
    const first = root.querySelector<HTMLButtonElement>('[data-hide-participant="client"]')!
    expect(hideBtn(root, 'db')).toBe(first)
    expect(first.getAttribute('aria-label')).toBe('Hide Orders DB')
    expect(root.querySelector('[data-participant-menu="db"]')!.getAttribute('aria-label')).toBe(
      'More actions for Orders DB',
    )
    expect(first.closest('[data-participant-head]')!.getAttribute('data-participant-head')).toBe('db')
    expect(root.querySelectorAll('.participant-heads button')).toHaveLength(2)

    // Keyboard: arrows walk Hide and More of each header in turn and wrap.
    first.focus()
    press(first, 'ArrowLeft')
    expect(document.activeElement).toBe(root.querySelector('[data-participant-menu="api"]'))
    press(document.activeElement!, 'End')
    press(document.activeElement!, 'ArrowRight')
    expect(document.activeElement).toBe(root.querySelector('[data-hide-participant="client"]'))
    press(document.activeElement!, 'ArrowLeft')
    expect(document.activeElement).toBe(root.querySelector('[data-participant-menu="bus"]'))

    // Right-click on a header without the buttons brings them there, so Escape returns focus.
    const api = root.querySelector<HTMLElement>('[data-participant-head="api"]')!
    api.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(api.querySelector('[data-hide-participant="api"]')).not.toBeNull()
  })
})
