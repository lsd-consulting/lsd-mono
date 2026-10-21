// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bindHelpDialog, helpDialogHtml, type HelpDialog } from '../ui/help-dialog'

// The page, help and side panel keys through the router (lib/keys/bindings.test.ts covers the decisions).
const nav = vi.hoisted(() => ({ moveSelection: vi.fn(), focusedNavId: vi.fn(() => 'b') }))
const view = vi.hoisted(() => ({ focusSelectedDiagram: vi.fn() }))
const themeMenu = vi.hoisted(() => ({ paintThemeControl: vi.fn() }))
const theme = vi.hoisted(() => ({ toggleTheme: vi.fn(() => ({ mode: 'light', theme: 'light' })) }))
const ctx = vi.hoisted(() => ({
  session: {
    renderedId: 'a',
    inspector: { isOpen: (): boolean => false, close: vi.fn() },
    help: null as HelpDialog | null,
  },
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
  ctx.session.inspector.isOpen = () => false
  document.body.innerHTML = `<input type="search" id="search"><button id="btn-help">?</button><button id="btn">B</button>${helpDialogHtml('<input type="checkbox" id="single-keys">')}`
  ctx.session.help = bindHelpDialog(document)
})

describe('page keys', () => {
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
    const esc = press(document.activeElement!, 'Escape')
    expect(help()).toBe('false')
    expect(esc.defaultPrevented).toBe(true)
  })

  it('closes the help before the side panel, one Escape each (#112)', () => {
    ctx.session.inspector.isOpen = () => true
    press(document.body, '?')
    press(document.activeElement!, 'Escape')
    expect(help()).toBe('false')
    expect(ctx.session.inspector.close).not.toHaveBeenCalled()
    press(document.body, 'Escape')
    expect(ctx.session.inspector.close).toHaveBeenCalledOnce()
  })

  it('gives Escape in a text field to an open side panel first, and only to it', () => {
    const search = document.querySelector<HTMLInputElement>('#search')!
    search.value = 'order'
    search.focus()
    ctx.session.inspector.isOpen = () => true
    expect(press(search, 'Escape').defaultPrevented).toBe(true)
    expect(ctx.session.inspector.close).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(search)
    expect(search.value).toBe('order')
  })

  describe('Escape in search and Find (#114)', () => {
    const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!
    beforeEach(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<ul id="scenario-nav"><li><button data-nav="a" aria-current="true" id="item">A</button></li></ul>
        <main id="main"><div class="scenario-head"><h2 id="scenario-title" tabindex="-1">A</h2></div>
          <div class="seq-diagram"><input type="search" data-diagram-find id="find"><div class="seq-scroll" tabindex="-1" id="scroll"></div></div>
        </main>`,
      )
    })

    for (const [name, sel, owner] of [
      ['search', '#search', 'scenario-title'],
      ['Find', '#find', 'scroll'],
    ] as const) {
      it(`${name}: the first Escape clears the text the way deleting it would, and keeps focus`, () => {
        const field = $<HTMLInputElement>(sel)
        const inputs: string[] = []
        field.addEventListener('input', () => inputs.push(field.value))
        field.value = 'pay'
        field.focus()
        expect(press(field, 'Escape').defaultPrevented).toBe(true)
        expect(field.value).toBe('')
        expect(inputs).toEqual([''])
        expect(document.activeElement).toBe(field)
      })

      it(`${name}: Escape in the empty field moves focus to ${owner}, never the body`, () => {
        const field = $<HTMLInputElement>(sel)
        field.focus()
        expect(press(field, 'Escape').defaultPrevented).toBe(true)
        expect(document.activeElement?.id).toBe(owner)
      })

      it(`${name}: a held Escape clears once and goes no further`, () => {
        const field = $<HTMLInputElement>(sel)
        field.value = 'pay'
        field.focus()
        press(field, 'Escape')
        const held = press(field, 'Escape', { repeat: true })
        expect(held.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(field)
      })
    }

    it('Find: a scrollport barely on screen comes up to the middle of the window; one in view stays', () => {
      const scroll = $('#scroll')
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
      const at = (top: number) =>
        (scroll.getBoundingClientRect = () =>
          ({ top, bottom: top + 600, left: 0, right: 800, width: 800, height: 600 }) as DOMRect)
      const height = innerHeight
      // Its top 8px above the foot of the window (1280×800: y=792).
      at(height - 8)
      $('#find').focus()
      press($('#find'), 'Escape')
      expect(document.activeElement?.id).toBe('scroll')
      expect(scrollBy).toHaveBeenCalledTimes(1)
      expect(scrollBy.mock.calls[0][0]).toMatchObject({ top: height - 8 - height / 2 })
      // 100px or more of it shows: the page stays where it is.
      scrollBy.mockClear()
      at(height - 100)
      $('#find').focus()
      press($('#find'), 'Escape')
      expect(scrollBy).not.toHaveBeenCalled()
      scrollBy.mockRestore()
    })

    it('search with no scenario shown goes to the selected list item', () => {
      $('.scenario-head').remove()
      $('#search').focus()
      press($('#search'), 'Escape')
      expect(document.activeElement?.id).toBe('item')
    })

    it('search keeps focus when there is nowhere to go', () => {
      $('#main').remove()
      $('#scenario-nav').remove()
      $('#search').focus()
      press($('#search'), 'Escape')
      expect(document.activeElement?.id).toBe('search')
    })

    it('leaves the help checkbox alone: it is an input, but not a text field', () => {
      const check = $<HTMLInputElement>('#single-keys')
      check.focus()
      const ev = press(check, 'Escape')
      expect(document.activeElement).toBe(check)
      expect(check.value).toBe('on')
      expect(ev.defaultPrevented).toBe(false)
    })
  })

  it('leaves an Escape a widget has already taken', () => {
    ctx.session.inspector.isOpen = () => true
    document.body.addEventListener('keydown', (e) => e.preventDefault(), { once: true, capture: true })
    press(document.body, 'Escape')
    expect(ctx.session.inspector.close).not.toHaveBeenCalled()
  })

  it('does nothing for a key with no page action, and leaves the event alone', () => {
    const ev = press(document.querySelector('#btn')!, 'x')
    expect(ev.defaultPrevented).toBe(false)
    expect(nav.moveSelection).not.toHaveBeenCalled()
  })
})
