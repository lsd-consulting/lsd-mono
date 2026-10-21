// The participant header's actions (#8, #62): the one set of Hide and More buttons, moved onto
// the header in use; the row's roving tab stop; keys; whether the pointer or the keyboard is using
// the row; and long-press and tap for touch screens.
import { cssEscape } from '../escape'
import { barShown, placeBar } from './bar-place'
import { pressedIn, trackLastInput } from './input'
import { headActionButtonsHtml } from './markup'

/** How long a touch must rest on a header to open its menu. */
export const LONG_PRESS_MS = 550
const LONG_PRESS_SLOP = 10

type Point = { x: number; y: number }

/** What the header asks of the rest of the filter. */
export interface HeadActionsHooks {
  /** Open the menu for [id], from [opener] (a More button) or at [at] (a pointer). */
  openMenu: (id: string, opener: HTMLElement | null, at: Point | null) => void
  /** The participant the open menu is for, or null while it is closed. */
  menuFor: () => string | null
  hide: (id: string) => void
}

export interface HeadActions {
  headOf: (id: string) => HTMLElement | null
  /** Move the buttons onto [head] (renamed for it) and return them. A focused button keeps focus. */
  actionsOn: (head: HTMLElement) => HTMLElement
  /** Put the buttons on [head] and focus its Hide or More, as the row's tab stop. */
  focusHead: (head: HTMLElement, kind: 'hide' | 'more') => HTMLButtonElement
  /** A press outside the header: a tapped header hides its buttons again. */
  dismiss: (target: Node) => void
}

export function bindHeadActions(header: HTMLElement, hooks: HeadActionsHooks): HeadActions {
  const doc = header.ownerDocument
  const headButtons = () => Array.from(header.querySelectorAll<HTMLButtonElement>('.participant-heads button'))
  const heads = () => Array.from(header.querySelectorAll<HTMLElement>('[data-participant-head]'))
  const headOf = (id: string) => header.querySelector<HTMLElement>(`[data-participant-head="${cssEscape(id)}"]`)

  // Moved onto a header, the bar opens under it, or above it when the window has no room below.
  const actionsOn = (head: HTMLElement) => {
    const bar = moveActionsOnto(header, head)
    placeBar(head, bar)
    return bar
  }

  // While a bar shows, the page can scroll or the window change size under it: place it again.
  const win = doc.defaultView
  const replace = () => {
    if (!header.isConnected) {
      win?.removeEventListener('scroll', replace)
      win?.removeEventListener('resize', replace)
      return
    }
    const bar = header.querySelector<HTMLElement>('.participant-head-actions')
    const head = bar?.parentElement
    if (bar && head && (head.hasAttribute('data-bar-above') || barShown(head))) placeBar(head, bar)
  }
  win?.addEventListener('scroll', replace, { passive: true })
  win?.addEventListener('resize', replace, { passive: true })

  function focusHead(head: HTMLElement, kind: 'hide' | 'more'): HTMLButtonElement {
    const bar = actionsOn(head)
    const btn = bar.querySelector<HTMLButtonElement>(
      kind === 'hide' ? '[data-hide-participant]' : '[data-participant-menu]',
    )!
    roveTo(btn)
    btn.focus({ preventScroll: true })
    showWholeBar(btn)
    return btn
  }

  function roveTo(btn: HTMLButtonElement): void {
    for (const other of headButtons()) other.tabIndex = other === btn ? 0 : -1
  }

  /** Touch: a tap shows that header's buttons. A tap elsewhere hides them again. */
  function reveal(head: HTMLElement): void {
    actionsOn(head)
    header.querySelectorAll('[data-revealed]').forEach((el) => {
      if (el !== head) el.removeAttribute('data-revealed')
    })
    head.setAttribute('data-revealed', '')
  }

  const press = bindLongPress(header, (id, at) => hooks.openMenu(id, null, at))

  header.addEventListener('click', (ev) => {
    const target = ev.target as Element
    const hideBtn = target.closest<HTMLButtonElement>('[data-hide-participant]')
    if (hideBtn) {
      if (press.suppressed()) return
      hooks.hide(hideBtn.dataset.hideParticipant ?? '')
      return
    }
    const moreBtn = target.closest<HTMLButtonElement>('[data-participant-menu]')
    if (moreBtn) {
      if (press.suppressed()) return
      hooks.openMenu(moreBtn.dataset.participantMenu ?? '', moreBtn, null)
      return
    }
    const head = target.closest<HTMLElement>('[data-participant-head]')
    if (head && !press.suppressed()) reveal(head)
  })

  header.addEventListener('keydown', (ev) => {
    const btn = (ev.target as Element).closest?.<HTMLButtonElement>('.participant-heads button')
    if (btn) onButtonKey(ev, btn)
  })

  /** Arrows, Home and End along the row's buttons; the menu keys; Delete hides. */
  function onButtonKey(ev: KeyboardEvent, btn: HTMLButtonElement): void {
    const row = heads()
    const head = btn.closest<HTMLElement>('[data-participant-head]')!
    const id = head.dataset.participantHead ?? ''
    const to = rowKeyTarget(ev.key, row, head, btn.hasAttribute('data-participant-menu'))
    if (to) {
      ev.preventDefault()
      ev.stopPropagation()
      focusHead(...to)
    } else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
      ev.preventDefault()
      ev.stopPropagation()
      hooks.openMenu(id, btn, null)
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault()
      hooks.hide(id)
    }
  }

  trackLastInput(doc)

  // A pointer over a header brings the buttons there (and the row's tab stop with them), unless
  // the menu is open or the keyboard is using them.
  header.addEventListener('pointerover', (ev) => {
    const head = (ev.target as Element).closest?.<HTMLElement>('[data-participant-head]')
    if (!head || hooks.menuFor() !== null) return
    // Deliberate: while keyboard focus is in the header, hovering another header does not bring
    // the buttons there. Moving them would rename the focused button, and Enter would then hide
    // the participant under the pointer instead of the one the keyboard chose. Focus that came
    // from a press in this header (a mouse user) still lets them follow the pointer.
    if (header.contains(doc.activeElement) && !pressedIn(doc, header)) return
    actionsOn(head)
  })

  header.addEventListener('focusin', (ev) => {
    const btn = (ev.target as Element).closest?.<HTMLButtonElement>('.participant-heads button')
    if (!btn) return
    roveTo(btn)
    const bar = btn.closest<HTMLElement>('.participant-head-actions')
    if (bar?.parentElement) placeBar(bar.parentElement, bar)
    // Tab lands on Hide and the browser scrolls only that into view: bring More along too.
    showWholeBar(btn)
  })

  header.addEventListener('contextmenu', (ev) => {
    const head = (ev.target as Element).closest<HTMLElement>('[data-participant-head]')
    if (!head) return
    ev.preventDefault()
    // Android fires contextmenu after our own long-press opened the menu.
    if (hooks.menuFor() === head.dataset.participantHead) return
    hooks.openMenu(head.dataset.participantHead ?? '', null, { x: ev.clientX, y: ev.clientY })
  })

  press.listen()

  return {
    headOf,
    actionsOn,
    focusHead,
    dismiss(target) {
      if (!header.contains(target))
        header.querySelectorAll('[data-revealed]').forEach((el) => el.removeAttribute('data-revealed'))
    },
  }
}

/**
 * Long-press for touch screens that do not fire contextmenu (iOS Safari): [open] runs once a touch
 * has rested on a header for LONG_PRESS_MS, and the click the lifted finger makes is then
 * suppressed. A finger that moves is a scroll. [listen] adds the listeners.
 */
function bindLongPress(header: HTMLElement, open: (id: string, at: Point) => void) {
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let pressAt = { x: 0, y: 0 }
  let suppressClick = false
  const cancelPress = () => {
    if (pressTimer) clearTimeout(pressTimer)
    pressTimer = null
  }
  return {
    suppressed: () => suppressClick,
    listen(): void {
      header.addEventListener('pointerdown', (ev) => {
        suppressClick = false
        if (ev.pointerType !== 'touch') return
        const head = (ev.target as Element).closest<HTMLElement>('[data-participant-head]')
        if (!head) return
        pressAt = { x: ev.clientX, y: ev.clientY }
        cancelPress()
        pressTimer = setTimeout(() => {
          pressTimer = null
          suppressClick = true
          open(head.dataset.participantHead ?? '', pressAt)
        }, LONG_PRESS_MS)
      })
      header.addEventListener('pointermove', (ev) => {
        if (pressTimer && Math.hypot(ev.clientX - pressAt.x, ev.clientY - pressAt.y) > LONG_PRESS_SLOP) cancelPress()
      })
      header.addEventListener('pointerup', cancelPress)
      header.addEventListener('pointercancel', cancelPress)
    },
  }
}

/** The More button can sit past the scrollport's edge while Hide has focus: bring the whole bar
 * into view, not just the focused button. */
function showWholeBar(btn: HTMLElement): void {
  const bar = btn.closest<HTMLElement>('.participant-head-actions') ?? btn
  bar.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

/** Move the one set of Hide and More buttons onto [head], renamed for its participant. A button
 * that had focus keeps it. */
function moveActionsOnto(header: HTMLElement, head: HTMLElement): HTMLElement {
  const doc = header.ownerDocument
  const id = head.dataset.participantHead ?? ''
  const name = head.dataset.name ?? id
  const bar = header.querySelector<HTMLElement>('.participant-head-actions')
  if (bar?.parentElement === head) return bar
  if (!bar) {
    head.insertAdjacentHTML('beforeend', headActionButtonsHtml(id, name, 'hide'))
    return head.querySelector<HTMLElement>('.participant-head-actions')!
  }
  const focused = bar.contains(doc.activeElement) ? (doc.activeElement as HTMLElement) : null
  const hideBtn = bar.querySelector<HTMLButtonElement>('[data-hide-participant]')!
  const moreBtn = bar.querySelector<HTMLButtonElement>('[data-participant-menu]')!
  hideBtn.dataset.hideParticipant = id
  hideBtn.setAttribute('aria-label', `Hide ${name}`)
  moreBtn.dataset.participantMenu = id
  moreBtn.setAttribute('aria-label', `More actions for ${name}`)
  moreBtn.setAttribute('aria-expanded', 'false')
  head.append(bar)
  focused?.focus({ preventScroll: true })
  return bar
}

/** Where an arrow, Home or End moves to: Hide and More of each header in turn, wrapping at the ends. */
function rowKeyTarget(
  key: string,
  row: HTMLElement[],
  head: HTMLElement,
  onMore: boolean,
): [HTMLElement, 'hide' | 'more'] | undefined {
  const at = row.indexOf(head)
  if (key === 'ArrowRight') return onMore ? [row[(at + 1) % row.length], 'hide'] : [head, 'more']
  if (key === 'ArrowLeft') return onMore ? [head, 'hide'] : [row[(at - 1 + row.length) % row.length], 'more']
  if (key === 'Home') return [row[0], 'hide']
  if (key === 'End') return [row[row.length - 1], 'more']
  return undefined
}
