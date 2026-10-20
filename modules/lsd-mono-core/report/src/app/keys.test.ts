// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The page and side panel keys through the router (lib/keys/bindings.test.ts covers the decisions).
const nav = vi.hoisted(() => ({ moveSelection: vi.fn(), focusedNavId: vi.fn(() => 'b') }))
const view = vi.hoisted(() => ({ focusSelectedDiagram: vi.fn() }))
const themeMenu = vi.hoisted(() => ({ paintThemeControl: vi.fn() }))
const theme = vi.hoisted(() => ({ toggleTheme: vi.fn(() => ({ mode: 'light', theme: 'light' })) }))
const ctx = vi.hoisted(() => ({
  session: { renderedId: 'a', inspector: { isOpen: (): boolean => false, close: vi.fn() } },
  state: { helpOpen: false },
}))

vi.mock('./nav', () => nav)
vi.mock('./main-view', () => view)
vi.mock('../ui/theme-menu', () => themeMenu)
vi.mock('../ui/theme', () => theme)
vi.mock('../ui/shortcuts', () => ({ singleKeysEnabled: () => true }))
vi.mock('./context', () => ctx)
vi.mock('./diagram-keys', () => ({ registerDiagramKeys: () => {} }))

const { keyContexts, registerPageKeys, registerPanelKeys } = await import('./keys')
const { createKeyRouter } = await import('../lib/keys/router')
const router = createKeyRouter(keyContexts)
registerPanelKeys(router)
registerPageKeys(router)

/** Dispatches [key] on [target] the way the document listener sees it, and returns the event. */
function press(target: EventTarget, key: string, mods: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods })
  target.addEventListener('keydown', (e) => router.dispatch(e as KeyboardEvent), { once: true })
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
  it('leaves an Escape the side panel has already taken, so the help stays open (#102)', () => {
    ctx.state.helpOpen = true
    document.querySelector('#help')!.setAttribute('data-open', 'true')
    document.body.addEventListener('keydown', (e) => e.preventDefault(), { once: true, capture: true })
    press(document.body, 'Escape')
    expect(help()).toBe('true')
    expect(ctx.state.helpOpen).toBe(true)
  })

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
    expect(themeMenu.paintThemeControl).toHaveBeenCalledWith({ mode: 'light', theme: 'light' })
  })

  it('toggles the help with ?, and Escape closes it', () => {
    press(document.body, '?')
    expect(help()).toBe('true')
    expect(ctx.state.helpOpen).toBe(true)
    const esc = press(document.body, 'Escape')
    expect(help()).toBe('false')
    expect(esc.defaultPrevented).toBe(true)
  })

  it('lets go of a text field on Escape, and gives Escape to an open side panel first, and only to it', () => {
    const search = document.querySelector<HTMLInputElement>('#search')!
    search.focus()
    expect(press(search, 'Escape').defaultPrevented).toBe(true)
    expect(document.activeElement).not.toBe(search)
    search.focus()
    ctx.session.inspector.isOpen = () => true
    ctx.state.helpOpen = true
    expect(press(search, 'Escape').defaultPrevented).toBe(true)
    expect(ctx.session.inspector.close).toHaveBeenCalledOnce()
    expect(ctx.state.helpOpen).toBe(true)
    expect(document.activeElement).toBe(search)
  })

  it('does nothing for a key with no page action, and leaves the event alone', () => {
    const ev = press(document.querySelector('#btn')!, 'x')
    expect(ev.defaultPrevented).toBe(false)
    expect(nav.moveSelection).not.toHaveBeenCalled()
  })
})
