// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_KEY } from './theme'
import { bindThemeMenu, paintThemeControl, themeControlHtml, themeIconHtml } from './theme-menu'

const btn = () => document.querySelector<HTMLButtonElement>('#btn-theme')!
const menu = () => document.querySelector<HTMLElement>('#theme-menu')!
const item = (mode: string) => document.querySelector<HTMLButtonElement>(`[data-theme-mode="${mode}"]`)!
const checked = () =>
  Array.from(document.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')).map((i) =>
    i.getAttribute('data-theme-mode'),
  )
const key = (el: Element, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  el.dispatchEvent(e)
  return e
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }))
  document.body.innerHTML = `${themeControlHtml('auto', 'dark')}<button id="elsewhere">x</button>`
  bindThemeMenu()
})
afterEach(() => vi.unstubAllGlobals())

describe('theme control markup', () => {
  it('is a menu button with four radio items, the current mode checked', () => {
    expect(btn().getAttribute('aria-haspopup')).toBe('menu')
    expect(btn().getAttribute('aria-expanded')).toBe('false')
    expect(btn().getAttribute('aria-label')).toBe('A. Theme: Auto (dark)')
    expect(btn().textContent).toBe('A')
    expect(menu().hidden).toBe(true)
    expect(Array.from(menu().querySelectorAll('[role="menuitemradio"]')).map((i) => i.textContent)).toEqual([
      'AAuto (follow the OS)✓',
      'Light✓',
      'Dark✓',
      'HCHigh contrast✓',
    ])
    expect(checked()).toEqual(['auto'])
  })

  it('draws a sun for light and a moon for dark, and writes A and HC as text', () => {
    expect(themeIconHtml('light')).toContain('<circle')
    expect(themeIconHtml('dark')).toContain('<path d="M20.985')
    expect(themeIconHtml('dark')).toContain('aria-hidden="true"')
    expect(themeIconHtml('contrast')).toBe('HC')
  })

  it('paints the button and the checked item for a new mode', () => {
    paintThemeControl({ mode: 'light', theme: 'light' })
    expect(btn().getAttribute('aria-label')).toBe('Theme: light')
    expect(btn().getAttribute('title')).toBe('Theme: light')
    expect(btn().querySelector('svg')).not.toBeNull()
    expect(checked()).toEqual(['light'])
  })

  it('does nothing without the control', () => {
    document.body.innerHTML = ''
    expect(() => {
      paintThemeControl({ mode: 'dark', theme: 'dark' })
      bindThemeMenu()
    }).not.toThrow()
  })
})

describe('theme menu', () => {
  it('opens on the checked item, and a choice applies, stores, repaints and closes', () => {
    btn().click()
    expect(menu().hidden).toBe(false)
    expect(btn().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(item('auto'))
    item('dark').click()
    // Dark from Auto (dark) is a deliberate pin: stored, and checked.
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(checked()).toEqual(['dark'])
    expect(btn().getAttribute('aria-label')).toBe('Theme: dark')
    expect(menu().hidden).toBe(true)
    expect(document.activeElement).toBe(btn())

    btn().click()
    item('auto').click()
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(checked()).toEqual(['auto'])
  })

  it('moves by arrows, Home and End, wraps, and Escape closes it back to the button', () => {
    key(btn(), 'ArrowDown')
    expect(menu().hidden).toBe(false)
    expect(document.activeElement).toBe(item('auto'))
    key(item('auto'), 'ArrowDown')
    expect(document.activeElement).toBe(item('light'))
    key(item('light'), 'End')
    expect(document.activeElement).toBe(item('contrast'))
    key(item('contrast'), 'ArrowDown')
    expect(document.activeElement).toBe(item('auto'))
    key(item('auto'), 'ArrowUp')
    expect(document.activeElement).toBe(item('contrast'))
    key(item('contrast'), 'Home')
    expect(document.activeElement).toBe(item('auto'))
    key(item('auto'), 'x')
    const esc = key(item('auto'), 'Escape')
    // Kept from the page's Escape handlers (side panel, help).
    expect(esc.defaultPrevented).toBe(true)
    expect(menu().hidden).toBe(true)
    expect(document.activeElement).toBe(btn())

    key(btn(), 'ArrowUp')
    expect(document.activeElement).toBe(item('contrast'))
    key(btn(), 'Enter')
  })

  it('closes on a second press, a click outside, or focus leaving', () => {
    btn().click()
    btn().click()
    expect(menu().hidden).toBe(true)

    btn().click()
    document.querySelector('#elsewhere')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu().hidden).toBe(true)

    btn().click()
    item('light').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: item('dark') }))
    expect(menu().hidden).toBe(false)
    item('light').dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: document.querySelector('#elsewhere') }),
    )
    expect(menu().hidden).toBe(true)

    // Shift+Tab back to the button closes it too.
    btn().click()
    item('auto').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: btn() }))
    expect(menu().hidden).toBe(true)
    // A pointer press on the button that already closed it (via focus) does not reopen it.
    btn().click()
    btn().dispatchEvent(new Event('pointerdown', { bubbles: true }))
    item('auto').dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: btn() }))
    btn().click()
    expect(menu().hidden).toBe(true)
    btn().click()
    expect(menu().hidden).toBe(false)
  })

  it('takes Escape on the button while open, and leaves it to the page when closed', () => {
    // Open with focus left on an item: the key lands on the button only where a press does not focus it.
    btn().click()
    const open = key(btn(), 'Escape')
    expect(open.defaultPrevented).toBe(true)
    expect(menu().hidden).toBe(true)
    const closed = key(btn(), 'Escape')
    expect(closed.defaultPrevented).toBe(false)
  })

  it('jumps to the item a letter starts, wrapping, and ignores other letters and modifiers', () => {
    btn().click()
    key(item('auto'), 'h')
    expect(document.activeElement).toBe(item('contrast'))
    key(item('contrast'), 'A')
    expect(document.activeElement).toBe(item('auto'))
    key(item('auto'), 'l')
    expect(document.activeElement).toBe(item('light'))
    const other = key(item('light'), 'q')
    expect(document.activeElement).toBe(item('light'))
    expect(other.defaultPrevented).toBe(true)
    item('light').dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }))
    expect(document.activeElement).toBe(item('light'))
  })

  it('ignores a click in the menu that is not on an item', () => {
    btn().click()
    menu().click()
    expect(menu().hidden).toBe(false)
  })
})
