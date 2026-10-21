// The "More lanes" cues (#65, #93): the pill on a wide screen, and on a phone the edge tab and the
// toolbar button. Each scrolls about one screen right, as Shift+→ does, and the status line then
// says which lanes are in view, so a screen reader user hears where the scroll went.
import { sidewaysScrollLeft } from '../diagram-a11y'
import { announceStatus } from './zoom-controls'

/** What a cue does: what Shift+→ does from the keyboard. */
const SCREEN_RIGHT = { key: 'ArrowRight', shiftKey: true, metaKey: false, ctrlKey: false, altKey: false }

/** Lane [names] in view, as the status line says them. [atEnd]: no lanes remain to the right. */
export function lanesInViewText(names: readonly string[], atEnd: boolean): string {
  const lead = atEnd ? 'Last lanes in view' : 'Lanes in view'
  if (names.length === 0) return lead
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${lead}: ${list}`
}

/** Names of the lanes whose lifelines lie within [left, left + clientWidth] of [scrollport], in order. */
export function laneNamesWithin(scrollport: HTMLElement, left: number): string[] {
  const port = scrollport.getBoundingClientRect()
  const names = new Map<string, string>()
  scrollport.querySelectorAll<HTMLElement>('[data-participant-head]').forEach((head) => {
    names.set(head.dataset.participantHead ?? '', head.dataset.name ?? head.dataset.participantHead ?? '')
  })
  return [...scrollport.querySelectorAll<Element>('.seq-header-svg .participant-box[data-participant]')]
    .filter((box) => {
      const r = box.getBoundingClientRect()
      // In the drawing's own coordinates, so a smooth scroll still on its way does not matter.
      const centre = r.left + r.width / 2 - port.left + scrollport.scrollLeft
      return centre >= left && centre <= left + scrollport.clientWidth
    })
    .map((box) => {
      const id = box.getAttribute('data-participant') ?? ''
      return names.get(id) ?? id
    })
}

/** Scroll [scrollport] about one screen right and say the lanes that come into view. */
export function showMoreLanes(scrollport: HTMLElement): void {
  const left = sidewaysScrollLeft(SCREEN_RIGHT, scrollport)
  if (left == null) return
  const atEnd = left + scrollport.clientWidth >= scrollport.scrollWidth - 4
  const status = scrollport.closest('.seq-diagram')?.querySelector('.participant-filter-status') ?? null
  const text = lanesInViewText(laneNamesWithin(scrollport, left), atEnd)
  scrollport.scrollLeft = left
  announceStatus(status, text)
}
