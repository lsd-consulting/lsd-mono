// Find in the diagram: the first match is the current one, and Next / Previous (Enter, Shift+Enter,
// F3, Cmd/Ctrl+G, or the toolbar buttons) step through the rest, wrapping around. It is brought on screen as the user
// types (after a short pause, so each keystroke does not jump the page) and on Enter / the soft
// keyboard's Go or Search key. The diagram scrolls with the page, so this moves the page, at the
// current zoom, below the top bar, the toolbar when it sticks, and the sticky participant header,
// and above the on-screen keyboard (visualViewport).
import {
  NO_PAYLOAD_HITS,
  eventHiddenByColumns,
  findMatch,
  searchCountHtml,
  searchCountLabel,
  searchCountParts,
} from '../diagram-view'
import { MESSAGE_LABEL_RISE, type LayoutRow } from '../layout'
import { payloadMatches } from './payload-find'
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
  /** Rows in [hits] whose payload matched. */
  inPayloads: number
  /** Payloads are still loading or being searched for this query. */
  pending: boolean
  /** The payloads could not be loaded. */
  failed: boolean
}

/**
 * Find's matches among [rows] for [query], with [currentId]'s place among them. A message also
 * matches when its id is in [payloadHits], the messages whose payload matched.
 */
export function searchState(
  rows: readonly LayoutRow[],
  query: string,
  hiddenIds: ReadonlySet<string>,
  currentId: string | null = null,
  payloadHits: ReadonlySet<string> = NO_PAYLOAD_HITS,
): SearchState {
  const hits: LayoutRow[] = []
  let hidden = 0
  let inPayloads = 0
  if (query.trim()) {
    for (const row of rows) {
      const match = findMatch(row.event, query, payloadHits)
      if (!match) continue
      if (eventHiddenByColumns(row.event, hiddenIds)) hidden++
      else {
        hits.push(row)
        if (match !== 'label') inPayloads++
      }
    }
  }
  const current = hits.findIndex((r) => r.event.id === currentId)
  return { hits, current, hidden, inPayloads, pending: false, failed: false }
}

/** The scenario's Find state, from its mounted rows, its view and what its payloads matched. */
export function scenarioSearchState(scenarioId: string): SearchState {
  const view = diagramView(scenarioId)
  const rows = diagramState.mounted.get(scenarioId)?.rows ?? []
  const payloads = payloadMatches(scenarioId)
  const state = searchState(rows, view.query, view.hidden, view.searchCurrentId ?? null, payloads.hits)
  return { ...state, pending: payloads.pending, failed: payloads.failed }
}

/** The live-region text for [state]: "2 of 5", or "5 matches" with no current match. */
export function searchStateLabel(state: SearchState, query: string): string {
  return searchCountLabel(state.hits.length + state.hidden, state.hidden, query, state.current + 1, state)
}

/** The same text as spans, so the phone toolbar can leave "N in payloads" to the {} bands. */
export function searchStateHtml(state: SearchState, query: string): string {
  const parts = searchCountParts(state.hits.length + state.hidden, state.hidden, query, state.current + 1, state)
  return searchCountHtml(parts)
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

/** Bring the Find count ("2 of 5") and the step buttons up to date with the scenario's matches. */
export function syncFindControls(scrollport: HTMLElement): void {
  const scenarioId = scrollport.dataset.scenarioId
  const root = scrollport.closest<HTMLElement>('.seq-diagram')
  if (!scenarioId || !root) return
  const state = scenarioSearchState(scenarioId)
  const count = root.querySelector('.diagram-find-count')
  if (count) count.innerHTML = searchStateHtml(state, diagramView(scenarioId).query)
  root
    .querySelectorAll<HTMLButtonElement>('[data-find-step]')
    .forEach((btn) => (btn.disabled = state.hits.length === 0))
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
  const view = diagramView(scenarioId)
  view.searchCurrentId = row?.event.id ?? null
  view.searchStepped = row !== null
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
  view.searchCurrentId = null
  view.searchStepped = false
  const row = scenarioSearchState(scenarioId).hits[0] ?? null
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
