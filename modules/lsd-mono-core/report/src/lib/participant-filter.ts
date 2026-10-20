import type { Participant } from '../types'
import { cssEscape, escapeAttr, escapeHtml } from './escape'
import { isCoarsePointer } from './media'

/**
 * Participant filter (#8). Each participant header offers Hide (×) and More (⋯)
 * buttons, shown on hover, keyboard focus, or a tap on touch screens. There is
 * one set of them, moved onto the header in use (#62), so a 100-participant
 * header is not ten nodes per participant.
 * The toolbar shows a chip only while something is hidden; it opens a list of
 * the hidden participants. Right-click, long-press, ⋯, or the context-menu key
 * on a header offers "Hide all but this one".
 *
 * Markup is built here from plain data; the diagram owns the hidden set and
 * redraws through [FilterHost].
 */

/** One header slot, in display pixels inside the sticky header. */
export interface HeadSlot {
  id: string
  name: string
  /** Shape kind, for the slot's tooltip ("Customer, actor"). */
  typeLabel: string
  left: number
  width: number
  /** Left of the button pill inside the slot: centred on the lifeline, kept inside the header. */
  pillX: number
}

/**
 * The page's last input, per document: a press (and where), or a key. Tracked on the document in
 * the capture phase, so a key pressed outside a header (Tab into it) counts, and so a press on a
 * header's name, which never moves focus into it, is forgotten at the next key. Any keydown
 * counts, even a lone Shift: the header stays in keyboard mode until the next press.
 */
const lastInput = new WeakMap<Document, { target: EventTarget | null } | null>()

function trackLastInput(doc: Document): void {
  if (lastInput.has(doc)) return
  lastInput.set(doc, null)
  doc.addEventListener('pointerdown', (ev) => lastInput.set(doc, { target: ev.target }), true)
  doc.addEventListener('keydown', () => lastInput.set(doc, null), true)
}

/** Whether the last input was a press inside [header]. */
function pressedIn(doc: Document, header: HTMLElement): boolean {
  const last = lastInput.get(doc)
  return last != null && last.target instanceof Node && header.contains(last.target)
}

/** Drawn width of the Hide and More pill (two 24 px buttons, gap, padding, border). */
export const PILL_W = 54
/** The pill on a touch screen: two 44 px buttons (TOUCH_HIT_CSS), as participant-filter.css draws it there (touch-sizes.test.ts keeps them in step). */
export const PILL_W_TOUCH = 94

function participantName(p: Participant): string {
  return p.alias ?? p.name
}

/** Hidden participants in diagram order. */
export function hiddenInOrder(participants: Participant[], hidden: ReadonlySet<string>): Participant[] {
  return participants.filter((p) => hidden.has(p.id))
}

/** The hidden set for "Hide all but this one". */
export function allBut(participants: Participant[], keep: string): Set<string> {
  return new Set(participants.filter((p) => p.id !== keep).map((p) => p.id))
}

function hiddenChipText(count: number): string {
  return `${count} hidden`
}

/**
 * Header slots split the header at the midpoints between lifelines, so every
 * point of the header belongs to exactly one participant. The outer slots reach
 * the header's edges.
 */
export function headSlots(
  visible: { id: string; name: string; typeLabel: string; x: number }[],
  headerWidth: number,
): HeadSlot[] {
  const pillW = isCoarsePointer() ? PILL_W_TOUCH : PILL_W
  return visible.map((p, i) => {
    const prev = visible[i - 1]
    const next = visible[i + 1]
    const left = prev ? (prev.x + p.x) / 2 : 0
    const right = next ? (p.x + next.x) / 2 : headerWidth
    // A pill past the header's edge would widen the scroll area and undo a fit.
    const pillLeft = Math.max(0, Math.min(p.x - pillW / 2, headerWidth - pillW))
    return {
      id: p.id,
      name: p.name,
      typeLabel: p.typeLabel,
      left,
      width: Math.max(0, right - left),
      pillX: pillLeft - left,
    }
  })
}

/**
 * The header's slots, and the one set of action buttons on the slot named by [focusKey] (or
 * the first). That set is the row's roving tab stop: the button named by [focusKey] (or Hide)
 * has tabindex 0. [bindParticipantFilter] moves it onto whichever header is in use.
 */
export function headActionsHtml(slots: HeadSlot[], height: number, focusKey: string | null): string {
  if (!slots.length) return ''
  const keys = slots.flatMap((s) => [`hide:${s.id}`, `more:${s.id}`])
  const active = focusKey && keys.includes(focusKey) ? focusKey : keys[0]
  const [kind, ...rest] = active.split(':')
  const activeId = rest.join(':')
  const heads = slots
    .map((s) => {
      const actions = s.id === activeId ? headActionButtonsHtml(s.id, s.name, kind === 'more' ? 'more' : 'hide') : ''
      return `<div class="participant-head" data-participant-head="${escapeAttr(s.id)}" data-name="${escapeAttr(s.name)}" title="${escapeAttr(`${s.name}, ${s.typeLabel}`)}" style="left:${round(s.left)}px;width:${round(s.width)}px;height:${round(height)}px;--pill-x:${round(s.pillX)}px">${actions}</div>`
    })
    .join('')
  // A header drawn small (a fitted wide diagram, a phone) puts the buttons under it,
  // so they do not cover the name of the participant they act on.
  const compact = height < COMPACT_HEADER_PX ? ' data-compact' : ''
  return `<div class="participant-heads" role="toolbar" aria-label="Participants: ← and → move between Hide and More buttons, Shift+F10 for more actions"${compact}>${heads}</div>`
}

/** Hide and More for participant [id], with the tab stop on [tabStop]. */
export function headActionButtonsHtml(id: string, name: string, tabStop: 'hide' | 'more'): string {
  const attrId = escapeAttr(id)
  const attrName = escapeAttr(name)
  const tab = (kind: string) => (kind === tabStop ? '0' : '-1')
  return `<span class="participant-head-actions"><button type="button" class="participant-hide" data-hide-participant="${attrId}" aria-label="Hide ${attrName}" aria-keyshortcuts="Shift+F10" tabindex="${tab('hide')}">${CROSS_SVG}</button><button type="button" class="participant-more" data-participant-menu="${attrId}" aria-label="More actions for ${attrName}" aria-haspopup="menu" aria-expanded="false" tabindex="${tab('more')}">${DOTS_SVG}</button></span>`
}

/** Below this drawn header height the buttons sit under the header, not on it. */
export const COMPACT_HEADER_PX = 44

/** Chip and its popover. Empty while nothing is hidden, so the toolbar shows nothing. */
export function hiddenFilterHtml(scenarioId: string, hidden: Participant[], open: boolean): string {
  if (!hidden.length) return ''
  const popId = `hidden-pop-${escapeAttr(scenarioId)}`
  const items = hidden
    .map((p) => {
      const name = participantName(p)
      return `<li><span class="hidden-name">${escapeHtml(name)}</span><button type="button" data-show-participant="${escapeAttr(p.id)}" aria-label="Show ${escapeAttr(name)}">Show</button></li>`
    })
    .join('')
  const text = hiddenChipText(hidden.length)
  return `<button type="button" class="hidden-chip" data-hidden-chip aria-haspopup="dialog" aria-expanded="${open}" aria-controls="${popId}" aria-label="${escapeAttr(`${text} participant${hidden.length === 1 ? '' : 's'}`)}">${escapeHtml(text)}</button><div class="hidden-popover" id="${popId}" role="dialog" aria-label="Hidden participants"${open ? '' : ' hidden'}><ul>${items}</ul><button type="button" class="hidden-show-all" data-show-all>Show all</button></div>`
}

export interface MenuState {
  name: string
  /** False when this is the only participant still shown. */
  canHideOthers: boolean
  anyHidden: boolean
}

/** Context menu for one participant. Disabled items stay in the list, marked aria-disabled. */
export function participantMenuHtml(state: MenuState): string {
  const item = (action: string, label: string, enabled: boolean) =>
    `<button type="button" role="menuitem" tabindex="-1" data-menu-action="${escapeAttr(action)}"${enabled ? '' : ' aria-disabled="true"'}>${escapeHtml(label)}</button>`
  return [
    item('only', `Hide all but ${state.name}`, state.canHideOthers),
    item('hide', `Hide ${state.name}`, true),
    item('show-all', 'Show all', state.anyHidden),
  ].join('')
}

/** Live-region text after a change. */
export function filterStatusText(change: string, hiddenCount: number): string {
  return hiddenCount ? `${change}. ${hiddenChipText(hiddenCount)}.` : `${change}. All participants shown.`
}

const CROSS_SVG =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5"/></svg>'
const DOTS_SVG =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><circle cx="2" cy="6" r="1.3"/><circle cx="6" cy="6" r="1.3"/><circle cx="10" cy="6" r="1.3"/></svg>'

function round(n: number): number {
  return Math.round(n * 10) / 10
}

/** What the diagram does when the filter changes the hidden set. */
export interface FilterHost {
  participants: () => Participant[]
  hidden: () => ReadonlySet<string>
  /** Replace the hidden set and redraw the header, rows, chip and fit. */
  setHidden: (next: Set<string>) => void
}

/** Shift the hidden list left when it would run off the right of the window (phones). */
function keepOnScreen(pop: HTMLElement | null): void {
  if (!pop) return
  const room = pop.ownerDocument.documentElement.clientWidth
  const box = pop.getBoundingClientRect()
  const over = box.right - (room - 8)
  if (over > 0) pop.style.left = `${-Math.min(over, box.left - 8)}px`
}

/** Where focus goes after a change, once the header has been redrawn. */
type FocusAfter = { head: string } | { chip: true } | { popoverIndex: number } | null

/** How long a touch must rest on a header to open its menu. */
export const LONG_PRESS_MS = 550
const LONG_PRESS_SLOP = 10

/**
 * Wire one diagram's header actions, chip, popover and menu. Listeners sit on the
 * diagram root and delegate, so redrawing the header or the chip needs no rebinding.
 */
export function bindParticipantFilter(root: HTMLElement, host: FilterHost): void {
  const header = root.querySelector<HTMLElement>('.seq-sticky-header')
  const filter = root.querySelector<HTMLElement>('[data-participant-filter]')
  const status = root.querySelector<HTMLElement>('.participant-filter-status')
  const scenarioId = root.querySelector<HTMLElement>('.seq-scroll')?.dataset.scenarioId ?? ''
  if (!header || !filter) return
  const doc = root.ownerDocument
  const menu = doc.createElement('div')
  menu.className = 'participant-menu'
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  root.append(menu)
  let menuFor: string | null = null
  let menuOpener: HTMLElement | null = null
  let popoverOpen = false

  const nameOf = (id: string) => {
    const p = host.participants().find((item) => item.id === id)
    return p ? participantName(p) : id
  }
  const announce = (text: string) => {
    if (status) status.textContent = text
  }
  const headButtons = () => Array.from(header.querySelectorAll<HTMLButtonElement>('.participant-heads button'))
  const heads = () => Array.from(header.querySelectorAll<HTMLElement>('[data-participant-head]'))
  const headOf = (id: string) => header.querySelector<HTMLElement>(`[data-participant-head="${cssEscape(id)}"]`)

  /**
   * Move the one set of Hide and More buttons onto [head], renamed for its participant, and
   * return it. A button that had focus keeps it.
   */
  function actionsOn(head: HTMLElement): HTMLElement {
    const id = head.dataset.participantHead ?? ''
    const name = head.dataset.name ?? id
    const bar = header!.querySelector<HTMLElement>('.participant-head-actions')
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

  /** Put the buttons on [head] and focus its Hide or More, as the row's tab stop. */
  function focusHead(head: HTMLElement, kind: 'hide' | 'more'): HTMLButtonElement {
    const bar = actionsOn(head)
    const btn = bar.querySelector<HTMLButtonElement>(
      kind === 'hide' ? '[data-hide-participant]' : '[data-participant-menu]',
    )!
    roveTo(btn)
    btn.focus({ preventScroll: true })
    // The More button can sit past the scrollport's right edge: bring the pill into view.
    btn.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    return btn
  }

  function renderFilter(focusChip = false): void {
    const hidden = hiddenInOrder(host.participants(), host.hidden())
    if (!hidden.length) popoverOpen = false
    filter!.innerHTML = hiddenFilterHtml(scenarioId, hidden, popoverOpen)
    if (popoverOpen) keepOnScreen(filter!.querySelector<HTMLElement>('.hidden-popover'))
    if (focusChip) filter!.querySelector<HTMLButtonElement>('[data-hidden-chip]')?.focus()
  }

  function focusAfter(target: FocusAfter): void {
    if (!target) return
    if ('chip' in target) {
      filter!.querySelector<HTMLButtonElement>('[data-hidden-chip]')?.focus()
      return
    }
    if ('popoverIndex' in target) {
      const shows = Array.from(filter!.querySelectorAll<HTMLButtonElement>('[data-show-participant]'))
      ;(shows[Math.min(target.popoverIndex, shows.length - 1)] ?? null)?.focus()
      return
    }
    const head = headOf(target.head)
    if (head) focusHead(head, 'hide')
  }

  /** Change the hidden set, redraw, announce, then move focus. */
  function change(next: Set<string>, said: string, focus: FocusAfter): void {
    host.setHidden(next)
    renderFilter()
    announce(filterStatusText(said, next.size))
    focusAfter(focus)
  }

  /**
   * Focus goes to the next header (or the chip when none is left), never to the
   * page. Headers reveal their buttons on :focus-visible, so after a mouse click
   * the next header's buttons do not pop up.
   */
  function hide(id: string): void {
    const visible = host.participants().filter((p) => !host.hidden().has(p.id))
    const at = visible.findIndex((p) => p.id === id)
    if (at < 0) return
    const neighbour = visible[at + 1] ?? visible[at - 1]
    const next = new Set(host.hidden())
    next.add(id)
    change(next, `${nameOf(id)} hidden`, neighbour ? { head: neighbour.id } : { chip: true })
  }

  function showOne(id: string): void {
    const list = hiddenInOrder(host.participants(), host.hidden())
    const index = list.findIndex((p) => p.id === id)
    const next = new Set(host.hidden())
    next.delete(id)
    change(next, `${nameOf(id)} shown`, next.size ? { popoverIndex: Math.max(0, index) } : { head: id })
  }

  function showAll(focusHead: boolean): void {
    if (!host.hidden().size) return
    const first = host.participants()[0]?.id
    change(new Set(), 'All participants shown', focusHead && first ? { head: first } : null)
  }

  function hideAllBut(id: string): void {
    const next = allBut(host.participants(), id)
    change(next, `Only ${nameOf(id)} shown`, { head: id })
  }

  // --- Header: roving tab stop, Hide, More, context menu -----------------------------------

  function roveTo(btn: HTMLButtonElement): void {
    for (const other of headButtons()) other.tabIndex = other === btn ? 0 : -1
  }

  header.addEventListener('click', (ev) => {
    const target = ev.target as Element
    const hideBtn = target.closest<HTMLButtonElement>('[data-hide-participant]')
    if (hideBtn) {
      if (suppressClick) return
      hide(hideBtn.dataset.hideParticipant ?? '')
      return
    }
    const moreBtn = target.closest<HTMLButtonElement>('[data-participant-menu]')
    if (moreBtn) {
      if (suppressClick) return
      openMenu(moreBtn.dataset.participantMenu ?? '', moreBtn, null)
      return
    }
    const head = target.closest<HTMLElement>('[data-participant-head]')
    if (head && !suppressClick) reveal(head)
  })

  header.addEventListener('keydown', (ev) => {
    const btn = (ev.target as Element).closest?.<HTMLButtonElement>('.participant-heads button')
    if (!btn) return
    const row = heads()
    const head = btn.closest<HTMLElement>('[data-participant-head]')!
    const at = row.indexOf(head)
    const onMore = btn.hasAttribute('data-participant-menu')
    const id = head.dataset.participantHead ?? ''
    // Hide and More of each header in turn, wrapping at the ends.
    let to: [HTMLElement, 'hide' | 'more'] | undefined
    if (ev.key === 'ArrowRight') to = onMore ? [row[(at + 1) % row.length], 'hide'] : [head, 'more']
    else if (ev.key === 'ArrowLeft') to = onMore ? [head, 'hide'] : [row[(at - 1 + row.length) % row.length], 'more']
    else if (ev.key === 'Home') to = [row[0], 'hide']
    else if (ev.key === 'End') to = [row[row.length - 1], 'more']
    else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
      ev.preventDefault()
      ev.stopPropagation()
      openMenu(id, btn, null)
      return
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault()
      hide(id)
      return
    } else return
    ev.preventDefault()
    ev.stopPropagation()
    focusHead(...to)
  })

  trackLastInput(doc)

  // A pointer over a header brings the buttons there (and the row's tab stop with them), unless
  // the menu is open or the keyboard is using them.
  header.addEventListener('pointerover', (ev) => {
    const head = (ev.target as Element).closest?.<HTMLElement>('[data-participant-head]')
    if (!head || !menu.hidden) return
    // Deliberate: while keyboard focus is in the header, hovering another header does not bring
    // the buttons there. Moving them would rename the focused button, and Enter would then hide
    // the participant under the pointer instead of the one the keyboard chose. Focus that came
    // from a press in this header (a mouse user) still lets them follow the pointer.
    if (header.contains(doc.activeElement) && !pressedIn(doc, header)) return
    actionsOn(head)
  })

  header.addEventListener('focusin', (ev) => {
    const btn = (ev.target as Element).closest?.<HTMLButtonElement>('.participant-heads button')
    if (btn) roveTo(btn)
  })

  header.addEventListener('contextmenu', (ev) => {
    const head = (ev.target as Element).closest<HTMLElement>('[data-participant-head]')
    if (!head) return
    ev.preventDefault()
    // Android fires contextmenu after our own long-press opened the menu.
    if (!menu.hidden && menuFor === head.dataset.participantHead) return
    openMenu(head.dataset.participantHead ?? '', null, { x: ev.clientX, y: ev.clientY })
  })

  // Long-press for touch screens that do not fire contextmenu (iOS Safari).
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let pressAt = { x: 0, y: 0 }
  let suppressClick = false
  const cancelPress = () => {
    if (pressTimer) clearTimeout(pressTimer)
    pressTimer = null
  }
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
      openMenu(head.dataset.participantHead ?? '', null, pressAt)
    }, LONG_PRESS_MS)
  })
  header.addEventListener('pointermove', (ev) => {
    if (pressTimer && Math.hypot(ev.clientX - pressAt.x, ev.clientY - pressAt.y) > LONG_PRESS_SLOP) cancelPress()
  })
  header.addEventListener('pointerup', cancelPress)
  header.addEventListener('pointercancel', cancelPress)

  /** Touch: a tap shows that header's buttons. A tap elsewhere hides them again. */
  function reveal(head: HTMLElement): void {
    actionsOn(head)
    header!.querySelectorAll('[data-revealed]').forEach((el) => {
      if (el !== head) el.removeAttribute('data-revealed')
    })
    head.setAttribute('data-revealed', '')
  }
  onOutsidePointer(doc, root, (target) => {
    if (!header.contains(target))
      header.querySelectorAll('[data-revealed]').forEach((el) => el.removeAttribute('data-revealed'))
    if (!menu.hidden && !menu.contains(target)) closeMenu(false)
    if (popoverOpen && !filter.contains(target)) closePopover(false)
  })

  // --- Context menu --------------------------------------------------------------------------

  function menuItems(): HTMLButtonElement[] {
    return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
  }

  function openMenu(id: string, opener: HTMLElement | null, at: { x: number; y: number } | null): void {
    if (!id) return
    closePopover(false)
    const hidden = host.hidden()
    const shown = host.participants().filter((p) => !hidden.has(p.id))
    const name = nameOf(id)
    menu.innerHTML = participantMenuHtml({
      name,
      canHideOthers: shown.length > 1,
      anyHidden: hidden.size > 0,
    })
    menu.setAttribute('aria-label', `Actions for ${name}`)
    menuFor = id
    const head = headOf(id)
    if (head && !opener) actionsOn(head)
    menuOpener = opener ?? head?.querySelector<HTMLButtonElement>('[data-hide-participant]') ?? null
    menuOpener
      ?.closest('[data-participant-head]')
      ?.querySelector('[data-participant-menu]')
      ?.setAttribute('aria-expanded', 'true')
    menu.hidden = false
    const rootBox = root.getBoundingClientRect()
    const anchor = at ?? anchorBelow(opener ?? head ?? header!)
    const width = menu.offsetWidth || 200
    const x = Math.max(4, Math.min(anchor.x - rootBox.left, rootBox.width - width - 4))
    menu.style.left = `${Math.round(x)}px`
    menu.style.top = `${Math.round(anchor.y - rootBox.top)}px`
    const first = menuItems().find((item) => item.getAttribute('aria-disabled') !== 'true') ?? menuItems()[0]
    first?.focus()
  }

  function anchorBelow(el: Element): { x: number; y: number } {
    const box = el.getBoundingClientRect()
    return { x: box.left, y: box.bottom + 4 }
  }

  function closeMenu(returnFocus: boolean): void {
    if (menu.hidden) return
    menu.hidden = true
    header!
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
    closeMenu(false)
    if (action === 'only') hideAllBut(id)
    else if (action === 'hide') hide(id)
    else if (action === 'show-all') showAll(true)
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
      closeMenu(true)
      return
    } else if (ev.key === 'Tab') {
      closeMenu(true)
      return
    } else return
    ev.preventDefault()
    ev.stopPropagation()
    to?.focus()
  })

  // --- Hidden chip and popover ---------------------------------------------------------------

  function openPopover(): void {
    closeMenu(false)
    popoverOpen = true
    renderFilter()
    filter!.querySelector<HTMLButtonElement>('[data-show-participant]')?.focus()
  }

  function closePopover(returnFocus: boolean): void {
    if (!popoverOpen) return
    popoverOpen = false
    renderFilter(returnFocus)
  }

  filter.addEventListener('click', (ev) => {
    const target = ev.target as Element
    if (target.closest('[data-hidden-chip]')) {
      if (popoverOpen) closePopover(true)
      else openPopover()
      return
    }
    const show = target.closest<HTMLButtonElement>('[data-show-participant]')
    if (show) {
      showOne(show.dataset.showParticipant ?? '')
      return
    }
    if (target.closest('[data-show-all]')) showAll(true)
  })

  filter.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !popoverOpen) return
    ev.preventDefault()
    ev.stopPropagation()
    closePopover(true)
  })

  // Tabbing out of the popover closes it.
  filter.addEventListener('focusout', (ev) => {
    const next = ev.relatedTarget as Node | null
    if (popoverOpen && next && !filter.contains(next)) closePopover(false)
  })

  renderFilter()
}

/**
 * One document listener for every diagram. A re-render replaces the diagrams, so
 * handlers for roots that left the page are dropped on the next press.
 */
const outside = new Map<HTMLElement, (target: Node) => void>()
const listening = new WeakSet<Document>()

function onOutsidePointer(doc: Document, root: HTMLElement, handler: (target: Node) => void): void {
  outside.set(root, handler)
  if (listening.has(doc)) return
  listening.add(doc)
  doc.addEventListener('pointerdown', (ev) => {
    for (const [el, run] of outside) {
      if (!el.isConnected) outside.delete(el)
      else run(ev.target as Node)
    }
  })
}
