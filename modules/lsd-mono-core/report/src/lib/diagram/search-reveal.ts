// Find in the diagram: the first match is the current one, and Next / Previous (Enter, Shift+Enter,
// F3, Cmd/Ctrl+G, or the toolbar buttons) step through the rest, wrapping around. It is brought on screen as the user
// types (after a short pause, so each keystroke does not jump the page) and on Enter / the soft
// keyboard's Go or Search key. The diagram scrolls with the page, so this moves the page, at the
// current zoom, below the top bar, the toolbar when it sticks, and the sticky participant header,
// and above the on-screen keyboard (visualViewport).
import { eventHiddenByColumns, rowMatchesQuery, searchCountLabel } from '../diagram-view'
import { MESSAGE_LABEL_RISE, type LayoutRow } from '../layout'
import { scrollDiagramToOffset } from './page-scroll'
import { diagramState, diagramView } from './state'

/** Pause after the last keystroke before the page moves to the first match. */
export const SEARCH_REVEAL_DELAY_MS = 250

/** Room left above a match when it is brought to the top of the diagram. */
const MARGIN_PX = 8

/** Find's matches over the drawn rows: the one source for the count, "N of M" and stepping. */
export interface SearchState {
  /** Matching rows you can step to, in drawing order (not on a hidden column). */
  hits: LayoutRow[]
  /** Index of the current match in [hits], or -1. */
  current: number
  /** Matching rows on a hidden column: counted, but not stepped to. */
  hidden: number
}

/** Find's matches among [rows] for [query], with [currentId]'s place among them. */
export function searchState(
  rows: readonly LayoutRow[],
  query: string,
  hiddenIds: ReadonlySet<string>,
  currentId: string | null = null,
): SearchState {
  const hits: LayoutRow[] = []
  let hidden = 0
  if (query.trim()) {
    for (const row of rows) {
      if (!rowMatchesQuery(row.event, query)) continue
      if (eventHiddenByColumns(row.event, hiddenIds)) hidden++
      else hits.push(row)
    }
  }
  return { hits, current: hits.findIndex((r) => r.event.id === currentId), hidden }
}

/** The scenario's Find state, from its mounted rows and view. */
export function scenarioSearchState(scenarioId: string): SearchState {
  const view = diagramView(scenarioId)
  const rows = diagramState.mounted.get(scenarioId)?.rows ?? []
  return searchState(rows, view.query, view.hidden, view.searchCurrentId ?? null)
}

/** The live-region text for [state]: "2 of 5", or "5 matches" with no current match. */
export function searchStateLabel(state: SearchState, query: string): string {
  return searchCountLabel(state.hits.length + state.hidden, state.hidden, query, state.current + 1)
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
  const state = scenarioSearchState(scenarioId)
  const row = state.hits[stepIndex(state.hits.length, state.current, step)] ?? null
  diagramView(scenarioId).searchCurrentId = row?.event.id ?? null
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
  const row = diagram ? (searchState(diagram.rows, view.query, view.hidden).hits[0] ?? null) : null
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
