// The participant filter (#8): Hide and More on each header, the menu, and the hidden chip.
// bindParticipantFilter puts together the controllers in filter/ and owns what a change does:
// the hidden set, the status line, and where focus goes next. The markup is in filter/markup.ts.
import { bindHeadActions } from './filter/head-actions'
import { bindHiddenChip } from './filter/hidden-chip'
import { onOutsidePointer } from './filter/input'
import { allBut, type FilterHost, filterStatusText, hiddenInOrder, participantName } from './filter/markup'
import { bindParticipantMenu } from './filter/participant-menu'

export { LONG_PRESS_MS } from './filter/head-actions'
export {
  type FilterHost,
  type HeadSlot,
  type MenuState,
  PILL_W,
  PILL_W_TOUCH,
  allBut,
  filterStatusText,
  headActionButtonsHtml,
  headActionsHtml,
  headSlotStyle,
  headSlots,
  hiddenFilterHtml,
  hiddenInOrder,
  participantMenuHtml,
} from './filter/markup'

/** Where focus goes after a change, once the header has been redrawn. */
type FocusAfter = { head: string } | { chip: true } | { popoverIndex: number } | null

/**
 * Wire one diagram's header actions, chip, popover and menu. Listeners sit on the diagram's
 * header, toolbar filter and menu and delegate, so redrawing the header or the chip needs no
 * rebinding.
 */
export function bindParticipantFilter(root: HTMLElement, host: FilterHost): void {
  const header = root.querySelector<HTMLElement>('.seq-sticky-header')
  const filter = root.querySelector<HTMLElement>('[data-participant-filter]')
  const status = root.querySelector<HTMLElement>('.participant-filter-status')
  const scenarioId = root.querySelector<HTMLElement>('.seq-scroll')?.dataset.scenarioId ?? ''
  if (!header || !filter) return
  const nameOf = (id: string) => {
    const p = host.participants().find((item) => item.id === id)
    return p ? participantName(p) : id
  }
  const act = filterActions(host, nameOf, (next, said, focus) => {
    host.setHidden(next)
    chip.render()
    if (status) status.textContent = filterStatusText(said, next.size)
    focusAfter(focus)
  })
  // The menu and the header each need the other: the menu reaches the header through a closure,
  // called only once both are bound.
  const menu = bindParticipantMenu(root, header, {
    host,
    nameOf,
    heads: () => heads,
    closePopover: () => chip.close(false),
    act,
  })
  const heads = bindHeadActions(header, { openMenu: menu.open, menuFor: menu.openFor, hide: act.hide })
  const chip = bindHiddenChip(filter, {
    scenarioId,
    host,
    closeMenu: () => menu.close(false),
    showOne: act.showOne,
    showAll: act.showAll,
  })
  onOutsidePointer(root.ownerDocument, root, (target) => {
    heads.dismiss(target)
    menu.dismiss(target)
    chip.dismiss(target)
  })

  function focusAfter(target: FocusAfter): void {
    if (!target) return
    if ('chip' in target) chip.focusChip()
    else if ('popoverIndex' in target) chip.focusShow(target.popoverIndex)
    else {
      const head = heads.headOf(target.head)
      if (head) heads.focusHead(head, 'hide')
    }
  }

  chip.render()
}

/**
 * The four changes, each as the hidden set it leaves, what the status line says, and where focus
 * goes. Hide moves focus to the next header (or the chip when none is left), never to the page.
 * Headers reveal their buttons on :focus-visible, so after a mouse click the next header's buttons
 * do not pop up.
 */
function filterActions(
  host: FilterHost,
  nameOf: (id: string) => string,
  change: (next: Set<string>, said: string, focus: FocusAfter) => void,
) {
  return {
    hide: (id: string): void => {
      const visible = host.participants().filter((p) => !host.hidden().has(p.id))
      const at = visible.findIndex((p) => p.id === id)
      if (at < 0) return
      const neighbour = visible[at + 1] ?? visible[at - 1]
      const next = new Set(host.hidden())
      next.add(id)
      change(next, `${nameOf(id)} hidden`, neighbour ? { head: neighbour.id } : { chip: true })
    },
    showOne: (id: string): void => {
      const list = hiddenInOrder(host.participants(), host.hidden())
      const index = list.findIndex((p) => p.id === id)
      const next = new Set(host.hidden())
      next.delete(id)
      change(next, `${nameOf(id)} shown`, next.size ? { popoverIndex: Math.max(0, index) } : { head: id })
    },
    showAll: (focusHead: boolean): void => {
      if (!host.hidden().size) return
      const first = host.participants()[0]?.id
      change(new Set(), 'All participants shown', focusHead && first ? { head: first } : null)
    },
    hideAllBut: (id: string): void => {
      change(allBut(host.participants(), id), `Only ${nameOf(id)} shown`, { head: id })
    },
  }
}
