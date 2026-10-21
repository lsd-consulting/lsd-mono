// The theme control in the top bar (#106): a button that shows the current mode, and a menu of
// the four modes (the menu button pattern: GitHub, MDN and VS Code web do the same). `d` steps
// the same modes from the keyboard (keys.ts).
import { escapeAttr, escapeHtml } from '../lib/escape'
import { THEME_MODES, chooseMode, themeButtonLabel, themeIcon, type Theme, type ThemeMode } from './theme'

const SVG =
  'class="theme-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
// Lucide `sun` (ISC) and `moon` (ISC, from Feather: MIT). See THIRD-PARTY-NOTICES.md.
const SUN = `<svg ${SVG}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
const MOON = `<svg ${SVG}><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`

const ITEM_LABEL: Record<ThemeMode, string> = {
  auto: 'Auto (follow the OS)',
  light: 'Light',
  dark: 'Dark',
  contrast: 'High contrast',
}

/** The mode's icon: the text A or HC, or a drawn sun (light) or moon (dark). */
export function themeIconHtml(mode: ThemeMode): string {
  const icon = themeIcon(mode)
  if (icon === 'sun') return SUN
  if (icon === 'moon') return MOON
  return escapeHtml(icon)
}

/** The button and its (closed) menu, with `mode` checked. */
export function themeControlHtml(mode: ThemeMode, theme: Theme): string {
  const label = escapeAttr(themeButtonLabel(mode, theme))
  const items = THEME_MODES.map(
    (m) =>
      `<button type="button" role="menuitemradio" tabindex="-1" data-theme-mode="${m}" aria-checked="${m === mode}"><span class="theme-menu-icon" aria-hidden="true">${themeIconHtml(m)}</span><span class="theme-menu-label">${escapeHtml(ITEM_LABEL[m])}</span><span class="theme-menu-check" aria-hidden="true">✓</span></button>`,
  ).join('')
  return `<div class="theme-control">
          <button type="button" class="icon-btn" id="btn-theme" aria-haspopup="menu" aria-expanded="false" aria-controls="theme-menu" title="${label}" aria-label="${label}">${themeIconHtml(mode)}</button>
          <div class="theme-menu" id="theme-menu" role="menu" aria-label="Theme" hidden>${items}</div>
        </div>`
}

/** Shows `mode` on the button and checks it in the menu, after any change: a choice, `d`, the OS, another tab. */
export function paintThemeControl({ mode, theme }: { mode: ThemeMode; theme: Theme }, doc: Document = document): void {
  const btn = doc.querySelector('#btn-theme')
  if (!btn) return
  const label = themeButtonLabel(mode, theme)
  btn.innerHTML = themeIconHtml(mode)
  btn.setAttribute('aria-label', label)
  btn.setAttribute('title', label)
  doc.querySelectorAll('#theme-menu [data-theme-mode]').forEach((item) => {
    item.setAttribute('aria-checked', String(item.getAttribute('data-theme-mode') === mode))
  })
}

/** Type-ahead: the next item after `at` whose label starts with `letter`, wrapping (A, L, D, H). */
function byLetter(list: HTMLButtonElement[], at: number, letter: string): HTMLButtonElement | undefined {
  const starts = (item: HTMLButtonElement) =>
    (item.querySelector('.theme-menu-label')?.textContent ?? '').toLowerCase().startsWith(letter.toLowerCase())
  for (let step = 1; step <= list.length; step++) {
    const item = list[(at + step + list.length) % list.length]
    if (starts(item)) return item
  }
  return undefined
}

/** Opens and closes the menu, moves through it by keyboard, and applies a choice. */
export function bindThemeMenu(doc: Document = document): void {
  const btn = doc.querySelector<HTMLButtonElement>('#btn-theme')
  const menu = doc.querySelector<HTMLElement>('#theme-menu')
  const control = btn?.closest<HTMLElement>('.theme-control')
  if (!btn || !menu || !control) return
  const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))

  const onOutside = (e: Event) => {
    if (!(e.target instanceof Node) || !control.contains(e.target)) close(false)
  }
  function open(focus: 'checked' | 'first' | 'last'): void {
    menu!.hidden = false
    btn!.setAttribute('aria-expanded', 'true')
    doc.addEventListener('pointerdown', onOutside, true)
    const list = items()
    const checked = list.find((i) => i.getAttribute('aria-checked') === 'true')
    ;(focus === 'first' ? list[0] : focus === 'last' ? list[list.length - 1] : (checked ?? list[0]))?.focus()
  }
  function close(returnFocus: boolean): void {
    if (menu!.hidden) return
    menu!.hidden = true
    btn!.setAttribute('aria-expanded', 'false')
    doc.removeEventListener('pointerdown', onOutside, true)
    if (returnFocus) btn!.focus()
  }

  // A press on the button while the menu is open closes it. Focus moving to the button may have
  // closed it already (focusout below), so remember what the press started with.
  let pressedOpen = false
  btn.addEventListener('pointerdown', () => (pressedOpen = !menu.hidden))
  btn.addEventListener('click', () => {
    const wasOpen = pressedOpen || !menu.hidden
    pressedOpen = false
    if (wasOpen) close(true)
    else open('checked')
  })
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    open(e.key === 'ArrowDown' ? 'first' : 'last')
  })
  menu.addEventListener('keydown', (e) => {
    const list = items()
    const at = list.indexOf(doc.activeElement as HTMLButtonElement)
    let to: HTMLButtonElement | undefined
    if (e.key === 'ArrowDown') to = list[(at + 1) % list.length]
    else if (e.key === 'ArrowUp') to = list[(at - 1 + list.length) % list.length]
    else if (e.key === 'Home') to = list[0]
    else if (e.key === 'End') to = list[list.length - 1]
    else if (/^[a-z]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) to = byLetter(list, at, e.key)
    else return
    // The menu's keys stay here, away from the page shortcuts (`d`, `j`, `k`).
    e.preventDefault()
    e.stopPropagation()
    to?.focus()
  })
  // Escape anywhere in the control while the menu is open closes the menu only, not the side
  // panel or the help behind it.
  control.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || menu.hidden) return
    e.preventDefault()
    e.stopPropagation()
    close(true)
  })
  // Focus leaving the menu, to the button too (Shift+Tab), closes it.
  menu.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && !menu.contains(e.relatedTarget)) close(false)
  })
  menu.addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('[data-theme-mode]')
    if (!item) return
    const mode = item.getAttribute('data-theme-mode') as ThemeMode
    paintThemeControl({ mode, theme: chooseMode(mode) }, doc)
    close(true)
  })
}
