// The diagram's Find field: the query, payload search, and Next and Previous.
import { cssEscape } from '../escape'
import { refreshPayloadFind } from './payload-find'
import { invalidate } from './invalidate'
import {
  SEARCH_REVEAL_DELAY_MS,
  findFieldLabel,
  revealSearchHit,
  stepSearchCurrent,
  updateSearchCurrent,
} from './search-reveal'
import { diagramState, diagramView } from './state'
import { revealMessageX } from './window'

/** Bring the current Find match on screen, down the page and sideways. False when there is none. */
export function revealFindHit(scrollport: HTMLElement): boolean {
  if (!revealSearchHit(scrollport)) return false
  const scenarioId = scrollport.dataset.scenarioId
  const current = scenarioId ? diagramView(scenarioId).searchCurrentId : null
  if (current) revealMessageX(scrollport, current)
  return true
}

/** Step the diagram's find to its next (1) or previous (-1) match and bring it on screen. */
export function stepFind(scrollport: HTMLElement, step: 1 | -1): void {
  const scenarioId = scrollport.dataset.scenarioId
  const row = scenarioId ? stepSearchCurrent(scenarioId, step) : null
  if (!scenarioId || !row) return
  revealFindHit(scrollport)
  invalidate(scenarioId, ['window', 'find'])
  diagramState.findHooks.stepped?.(scenarioId, row.event.id)
}

/**
 * Find's query, its scope or its payload answers changed: the first match becomes current
 * (unless [current] is false), then the matches, the count and the side panel's marks repaint.
 */
function findChanged(scenarioId: string, current = true): void {
  if (current) updateSearchCurrent(scenarioId)
  invalidate(scenarioId, ['window', 'find', 'hooks'])
}

/** The scenario's mounted scrollport, looked up when an answer arrives (the diagram may have re-rendered). */
function scrollportOf(scenarioId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.seq-scroll[data-scenario-id="${cssEscape(scenarioId)}"]`)
}

/**
 * Search the scenario's payloads for its query. An answer that arrives after the keystroke
 * repaints the matches and the count, and unless the user has stepped since typing, the first
 * match becomes current and comes on screen.
 */
export function refreshPayloads(scenarioId: string): void {
  const scenario = diagramState.mounted.get(scenarioId)?.scenario
  if (!scenario) return
  refreshPayloadFind(scenario, () => {
    const scroll = scrollportOf(scenarioId)
    if (!scroll) return
    const view = diagramView(scenarioId)
    const before = view.searchCurrentId ?? null
    // Until Next or Previous moves it, the current match is the first: maybe a payload match above.
    findChanged(scenarioId, !before || !view.searchStepped)
    if (view.searchCurrentId !== before) revealFindHit(scroll)
  })
}

/** Find's field, its payloads toggle, and Next and Previous. */
export function bindFind(diagram: Element, scroll: HTMLElement, id: string): void {
  const find = diagram.querySelector<HTMLInputElement>('[data-diagram-find]')
  // One pending reveal per scenario, kept in diagramState so a re-render or forgetDiagrams cancels it
  // instead of letting it fire on a scrollport that is gone (#165).
  const cancelReveal = () => {
    clearTimeout(diagramState.findReveals.get(id))
    diagramState.findReveals.delete(id)
  }
  cancelReveal()
  // Payloads load the first time Find is used, so they are often ready before the first key.
  find?.addEventListener('focus', () => refreshPayloads(id))
  if (diagramView(id).query) refreshPayloads(id)
  find?.addEventListener('input', () => {
    diagramView(id).query = find.value
    refreshPayloads(id)
    findChanged(id)
    // Typing on a phone has no Enter: bring the first match on screen once typing pauses.
    cancelReveal()
    const reveal = setTimeout(() => {
      diagramState.findReveals.delete(id)
      if (revealFindHit(scroll)) invalidate(id, ['window'])
    }, SEARCH_REVEAL_DELAY_MS)
    diagramState.findReveals.set(id, reveal)
  })
  diagram.querySelector<HTMLButtonElement>('[data-find-payloads]')?.addEventListener('click', (ev) => {
    const view = diagramView(id)
    view.includePayloads = !view.includePayloads
    const toggle = ev.currentTarget as HTMLButtonElement
    toggle.setAttribute('aria-pressed', String(view.includePayloads))
    find?.setAttribute('aria-label', findFieldLabel(view.includePayloads))
    refreshPayloads(id)
    findChanged(id)
  })
  diagram.querySelectorAll<HTMLButtonElement>('[data-find-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      cancelReveal()
      stepFind(scroll, btn.dataset.findStep === 'prev' ? -1 : 1)
    })
  })
}
