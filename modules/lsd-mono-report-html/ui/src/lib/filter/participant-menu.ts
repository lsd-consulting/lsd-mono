// The participant menu (#8): Hide all but this one, Hide, Show all. Opened from More, the
// context-menu key, Shift+F10, a right-click or a long press, at the opener or the pointer.
import type { HeadActions } from './head-actions'
import { type FilterHost, participantMenuHtml } from './markup'

/** What a menu item does. */
export interface MenuActions {
  hideAllBut: (id: string) => void
  hide: (id: string) => void
  showAll: (focusHead: boolean) => void
}

export interface ParticipantMenu {
  open: (id: string, opener: HTMLElement | null, at: { x: number; y: number } | null) => void
  close: (returnFocus: boolean) => void
  /** The participant the open menu is for, or null while it is closed. */
  openFor: () => string | null
  /** A press outside the menu closes it. */
  dismiss: (target: Node) => void
}

export function bindParticipantMenu(
  root: HTMLElement,
  header: HTMLElement,
  deps: {
    host: FilterHost
    nameOf: (id: string) => string
    heads: () => HeadActions
    closePopover: () => void
    act: MenuActions
  },
): ParticipantMenu {
  const doc = root.ownerDocument
  const menu = doc.createElement('div')
  menu.className = 'participant-menu'
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  root.append(menu)
  let menuFor: string | null = null
  let menuOpener: HTMLElement | null = null

  const menuItems = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))

  function open(id: string, opener: HTMLElement | null, at: { x: number; y: number } | null): void {
    if (!id) return
    deps.closePopover()
    const hidden = deps.host.hidden()
    const shown = deps.host.participants().filter((p) => !hidden.has(p.id))
    const name = deps.nameOf(id)
    menu.innerHTML = participantMenuHtml({ name, canHideOthers: shown.length > 1, anyHidden: hidden.size > 0 })
    menu.setAttribute('aria-label', `Actions for ${name}`)
    menuFor = id
    const head = deps.heads().headOf(id)
    if (head && !opener) deps.heads().actionsOn(head)
    menuOpener = opener ?? head?.querySelector<HTMLButtonElement>('[data-hide-participant]') ?? null
    menuOpener
      ?.closest('[data-participant-head]')
      ?.querySelector('[data-participant-menu]')
      ?.setAttribute('aria-expanded', 'true')
    menu.hidden = false
    place(at ?? anchorBelow(opener ?? head ?? header))
    const first = menuItems().find((item) => item.getAttribute('aria-disabled') !== 'true') ?? menuItems()[0]
    first?.focus()
  }

  /** Put the menu at [anchor] (page px), kept inside the diagram. */
  function place(anchor: { x: number; y: number }): void {
    const rootBox = root.getBoundingClientRect()
    const width = menu.offsetWidth || 200
    const x = Math.max(4, Math.min(anchor.x - rootBox.left, rootBox.width - width - 4))
    menu.style.left = `${Math.round(x)}px`
    menu.style.top = `${Math.round(anchor.y - rootBox.top)}px`
  }

  function close(returnFocus: boolean): void {
    if (menu.hidden) return
    menu.hidden = true
    header
      .querySelectorAll('[data-participant-menu][aria-expanded="true"]')
      .forEach((el) => el.setAttribute('aria-expanded', 'false'))
    const opener = menuOpener
    menuFor = null
    menuOpener = null
    if (returnFocus && opener?.isConnected) opener.focus()
  }

  menu.addEventListener('click', (ev) => {
    const item = (ev.target as Element).closest<HTMLButtonElement>('[data-menu-action]')
    if (!item || !menuFor) return
    if (item.getAttribute('aria-disabled') === 'true') return
    const id = menuFor
    const action = item.dataset.menuAction
    close(false)
    if (action === 'only') deps.act.hideAllBut(id)
    else if (action === 'hide') deps.act.hide(id)
    else if (action === 'show-all') deps.act.showAll(true)
  })

  menu.addEventListener('keydown', (ev) => {
    const items = menuItems()
    const i = items.indexOf(doc.activeElement as HTMLButtonElement)
    let to: HTMLButtonElement | undefined
    if (ev.key === 'ArrowDown') to = items[(i + 1) % items.length]
    else if (ev.key === 'ArrowUp') to = items[(i - 1 + items.length) % items.length]
    else if (ev.key === 'Home') to = items[0]
    else if (ev.key === 'End') to = items[items.length - 1]
    else if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      close(true)
      return
    } else if (ev.key === 'Tab') {
      close(true)
      return
    } else return
    ev.preventDefault()
    ev.stopPropagation()
    to?.focus()
  })

  return {
    open,
    close,
    openFor: () => menuFor,
    dismiss(target) {
      if (!menu.hidden && !menu.contains(target)) close(false)
    },
  }
}

function anchorBelow(el: Element): { x: number; y: number } {
  const box = el.getBoundingClientRect()
  return { x: box.left, y: box.bottom + 4 }
}
