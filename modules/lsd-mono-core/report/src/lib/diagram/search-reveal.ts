// Find in the diagram: the first match is the current one, and Next / Previous (Enter, Shift+Enter,
// F3, Cmd/Ctrl+G, or the toolbar buttons) step through the rest, wrapping around. It is brought on screen as the user
// types (after a short pause, so each keystroke does not jump the page) and on Enter / the soft
// keyboard's Go or Search key. The diagram scrolls with the page, so this moves the page, at the
// current zoom, below the top bar, the toolbar when it sticks, and the sticky participant header,
// and above the on-screen keyboard (visualViewport).
import { eventHiddenByColumns, rowMatchesQuery } from '../diagram-view'
import { MESSAGE_LABEL_RISE, type LayoutRow } from '../layout'
import { scrollDiagramToOffset } from './page-scroll'
import { diagramState, diagramView } from './state'

/** Pause after the last keystroke before the page moves to the first match. */
export const SEARCH_REVEAL_DELAY_MS = 250

/** Room left above a match when it is brought to the top of the diagram. */
const MARGIN_PX = 8

/** The rows that match the query, in drawing order, skipping rows on hidden columns. */
export function searchHits(rows: readonly LayoutRow[], query: string, hidden: ReadonlySet<string>): LayoutRow[] {
  if (!query.trim()) return []
  return rows.filter((row) => rowMatchesQuery(row.event, query) && !eventHiddenByColumns(row.event, hidden))
}

/** The first row that matches the query, in drawing order, skipping rows on hidden columns. */
export function firstSearchHit(
  rows: readonly LayoutRow[],
  query: string,
  hidden: ReadonlySet<string>,
): LayoutRow | null {
  return searchHits(rows, query, hidden)[0] ?? null
}

/**
 * The match after (step 1) or before (step -1) [current] among [count], wrapping around. With no
 * current match (-1) Next goes to the first and Previous to the last. -1 when nothing matches.
 */
export function stepIndex(count: number, current: number, step: 1 | -1): number {
  if (count <= 0) return -1
  if (current < 0) return step > 0 ? 0 : count - 1
  return (current + step + count) % count
}

/** The scenario's current match as a 1-based position among its matches, and how many it can step to. */
export function searchPosition(scenarioId: string): { current: number; count: number } {
  const view = diagramView(scenarioId)
  const rows = diagramState.mounted.get(scenarioId)?.rows ?? []
  const hits = searchHits(rows, view.query, view.hidden)
  return { current: hits.findIndex((r) => r.event.id === view.searchCurrentId) + 1, count: hits.length }
}

/** Find-box keys that step through matches: Enter / F3 / Cmd or Ctrl+G go to the next, with Shift the previous. */
export function findStepKey(
  ev: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>,
): 1 | -1 | null {
  const g = (ev.metaKey || ev.ctrlKey) && !ev.altKey && ev.key.toLowerCase() === 'g'
  if (ev.key !== 'Enter' && ev.key !== 'F3' && !g) return null
  return ev.shiftKey ? -1 : 1
}

/** Make the next (1) or previous (-1) match current. Returns it, or null when nothing matches. */
export function stepSearchCurrent(scenarioId: string, step: 1 | -1): LayoutRow | null {
  const view = diagramView(scenarioId)
  const hits = searchHits(diagramState.mounted.get(scenarioId)?.rows ?? [], view.query, view.hidden)
  const at = stepIndex(
    hits.length,
    hits.findIndex((r) => r.event.id === view.searchCurrentId),
    step,
  )
  const row = hits[at] ?? null
  view.searchCurrentId = row?.event.id ?? null
  return row
}

/** Top and bottom of what a row draws, in drawing pixels below the header: a label rises above its arrow, a note card is centred on its row. */
export function rowExtent(row: LayoutRow): { top: number; bottom: number } {
  if (row.event.kind === 'note') return { top: row.y - row.height / 2, bottom: row.y + row.height / 2 }
  return { top: row.y - MESSAGE_LABEL_RISE, bottom: row.y + 8 }
}

/** Set the scenario's current match from its query. Returns the row, or null when nothing matches. */
export function updateSearchCurrent(scenarioId: string): LayoutRow | null {
  const view = diagramView(scenarioId)
  const diagram = diagramState.mounted.get(scenarioId)
  const row = diagram ? firstSearchHit(diagram.rows, view.query, view.hidden) : null
  view.searchCurrentId = row?.event.id ?? null
  return row
}

/** Bottom of what the user can see: above the on-screen keyboard when there is one. */
function visibleBottom(): number {
  const vv = window.visualViewport
  return vv && vv.height > 0 ? vv.offsetTop + vv.height : window.innerHeight
}

/** Whether drawing pixels [top, bottom] (already zoomed) are on screen below the sticky header. */
export function extentOnScreen(scrollport: HTMLElement, top: number, bottom: number): boolean {
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')?.offsetHeight ?? 0
  const port = scrollport.getBoundingClientRect()
  const stuck = Number.parseFloat(getComputedStyle(scrollport).top) || 0
  const origin = port.top + header - scrollport.scrollTop
  const firstVisible = Math.max(port.top, stuck) + header
  const lastVisible = Math.min(visibleBottom(), port.top + (scrollport.clientHeight || port.height)) - MARGIN_PX
  return origin + top >= firstVisible && origin + bottom <= lastVisible
}

/** Bring the scenario's current match on screen if it is not. Returns whether there was one. */
export function revealSearchHit(scrollport: HTMLElement): boolean {
  const scenarioId = scrollport.dataset.scenarioId
  if (!scenarioId) return false
  const view = diagramView(scenarioId)
  const row = diagramState.mounted.get(scenarioId)?.rows.find((r) => r.event.id === view.searchCurrentId)
  if (!row) return false
  const { top, bottom } = rowExtent(row)
  if (!extentOnScreen(scrollport, top * view.zoom, bottom * view.zoom)) {
    scrollDiagramToOffset(scrollport, Math.max(0, top * view.zoom - MARGIN_PX))
  }
  return true
}
