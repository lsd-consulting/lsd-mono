// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// onKey carries out what pageKeyIntent decides (intents.test.ts covers the decisions).
const nav = vi.hoisted(() => ({ moveSelection: vi.fn(), focusedNavId: vi.fn(() => 'b') }))
const view = vi.hoisted(() => ({ focusSelectedDiagram: vi.fn() }))
const chrome = vi.hoisted(() => ({ paintThemeButton: vi.fn() }))
const theme = vi.hoisted(() => ({ toggleTheme: vi.fn(() => ({ mode: 'light', theme: 'light' })) }))
const ctx = vi.hoisted(() => ({
  session: { renderedId: 'a', inspector: { isOpen: (): boolean => false } },
  state: { helpOpen: false },
}))

vi.mock('./nav', () => nav)
vi.mock('./main-view', () => view)
vi.mock('./chrome', () => chrome)
vi.mock('../ui/theme', () => theme)
vi.mock('../ui/shortcuts', () => ({ singleKeysEnabled: () => true }))
vi.mock('./context', () => ctx)

const { onKey } = await import('./keys')

/** Dispatches [key] on [target] the way the window listener sees it, and returns the event. */
function press(target: EventTarget, key: string, mods: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods })
  target.addEventListener('keydown', (e) => onKey(e as KeyboardEvent), { once: true })
  target.dispatchEvent(ev)
  return ev
}
const help = () => document.querySelector('#help')!.getAttribute('data-open')

beforeEach(() => {
  vi.clearAllMocks()
  ctx.state.helpOpen = false
  ctx.session.inspector.isOpen = () => false
  document.body.innerHTML = `<input id="search"><div id="help" data-open="false"></div><button id="btn">B</button>`
})

describe('onKey', () => {
  it('focuses search with /', () => {
    const ev = press(document.body, '/')
    expect(document.activeElement?.id).toBe('search')
    expect(ev.defaultPrevented).toBe(true)
  })

  it('steps the selection from the focused list item with j and k', () => {
    press(document.body, 'j')
    press(document.body, 'k')
    expect(nav.moveSelection.mock.calls).toEqual([
      [1, 'b'],
      [-1, 'b'],
    ])
  })

  it('goes into the diagram with Enter, switches the theme with d', () => {
    press(document.body, 'Enter')
    press(document.body, 'd')
    expect(view.focusSelectedDiagram).toHaveBeenCalledOnce()
    expect(chrome.paintThemeButton).toHaveBeenCalledWith({ mode: 'light', theme: 'light' })
  })

  it('toggles the help with ?, and Escape closes it', () => {
    press(document.body, '?')
    expect(help()).toBe('true')
    expect(ctx.state.helpOpen).toBe(true)
    const esc = press(document.body, 'Escape')
    expect(help()).toBe('false')
    expect(esc.defaultPrevented).toBe(true)
  })

  it('lets go of a text field on Escape, and leaves Escape to an open side panel', () => {
    const search = document.querySelector<HTMLInputElement>('#search')!
    search.focus()
    expect(press(search, 'Escape').defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(search)
    search.focus()
    ctx.session.inspector.isOpen = () => true
    expect(press(search, 'Escape').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(search)
  })

  it('does nothing for a key with no page action, and leaves the event alone', () => {
    const ev = press(document.querySelector('#btn')!, 'x')
    expect(ev.defaultPrevented).toBe(false)
    expect(nav.moveSelection).not.toHaveBeenCalled()
  })
})
