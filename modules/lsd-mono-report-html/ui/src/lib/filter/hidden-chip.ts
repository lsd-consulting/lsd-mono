// The toolbar's hidden chip (#8): shown only while something is hidden, it opens a list of the
// hidden participants, each with Show, and Show all.
import { type FilterHost, hiddenFilterHtml, hiddenInOrder } from './markup'

export interface HiddenChip {
  /** Draw the chip (and the list, while open) for the hidden set now; focus the chip if asked. */
  render: (focusChip?: boolean) => void
  close: (returnFocus: boolean) => void
  focusChip: () => void
  /** Focus the [index]th Show button, or the last one. */
  focusShow: (index: number) => void
  /** A press outside the chip and its list closes the list. */
  dismiss: (target: Node) => void
}

export function bindHiddenChip(
  filter: HTMLElement,
  deps: {
    scenarioId: string
    host: FilterHost
    closeMenu: () => void
    showOne: (id: string) => void
    showAll: (focusHead: boolean) => void
  },
): HiddenChip {
  let popoverOpen = false

  function render(focusChip = false): void {
    const hidden = hiddenInOrder(deps.host.participants(), deps.host.hidden())
    if (!hidden.length) popoverOpen = false
    filter.innerHTML = hiddenFilterHtml(deps.scenarioId, hidden, popoverOpen)
    if (popoverOpen) keepOnScreen(filter.querySelector<HTMLElement>('.hidden-popover'))
    if (focusChip) filter.querySelector<HTMLButtonElement>('[data-hidden-chip]')?.focus()
  }

  function open(): void {
    deps.closeMenu()
    popoverOpen = true
    render()
    filter.querySelector<HTMLButtonElement>('[data-show-participant]')?.focus()
  }

  function close(returnFocus: boolean): void {
    if (!popoverOpen) return
    popoverOpen = false
    render(returnFocus)
  }

  filter.addEventListener('click', (ev) => {
    const target = ev.target as Element
    if (target.closest('[data-hidden-chip]')) {
      if (popoverOpen) close(true)
      else open()
      return
    }
    const show = target.closest<HTMLButtonElement>('[data-show-participant]')
    if (show) {
      deps.showOne(show.dataset.showParticipant ?? '')
      return
    }
    if (target.closest('[data-show-all]')) deps.showAll(true)
  })

  filter.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !popoverOpen) return
    ev.preventDefault()
    ev.stopPropagation()
    close(true)
  })

  // Tabbing out of the popover closes it.
  filter.addEventListener('focusout', (ev) => {
    const next = ev.relatedTarget as Node | null
    if (popoverOpen && next && !filter.contains(next)) close(false)
  })

  return {
    render,
    close,
    focusChip: () => filter.querySelector<HTMLButtonElement>('[data-hidden-chip]')?.focus(),
    focusShow(index) {
      const shows = Array.from(filter.querySelectorAll<HTMLButtonElement>('[data-show-participant]'))
      shows[Math.min(index, shows.length - 1)]?.focus()
    },
    dismiss(target) {
      if (popoverOpen && !filter.contains(target)) close(false)
    },
  }
}

/** Shift the hidden list left when it would run off the right of the window (phones). */
function keepOnScreen(pop: HTMLElement | null): void {
  if (!pop) return
  const room = pop.ownerDocument.documentElement.clientWidth
  const box = pop.getBoundingClientRect()
  const over = box.right - (room - 8)
  if (over > 0) pop.style.left = `${-Math.min(over, box.left - 8)}px`
}
