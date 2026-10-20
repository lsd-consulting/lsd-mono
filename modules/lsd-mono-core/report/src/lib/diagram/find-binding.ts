// The diagram's Find field: the query, payload search, and Next and Previous.
import { cssEscape } from '../escape'
import { refreshPayloadFind } from './payload-find'
import {
  SEARCH_REVEAL_DELAY_MS,
  findFieldLabel,
  revealSearchHit,
  syncFindControls,
  stepSearchCurrent,
  updateSearchCurrent,
} from './search-reveal'
import { diagramState, diagramView } from './state'
import { revealMessageX, syncDiagramWindow } from './window'

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
  syncFindControls(scrollport)
  syncDiagramWindow(scrollport)
  if (revealFindHit(scrollport)) syncDiagramWindow(scrollport)
  diagramState.findHooks.stepped?.(scenarioId, row.event.id)
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
    if (!before || !view.searchStepped) updateSearchCurrent(scenarioId)
    syncFindControls(scroll)
    syncDiagramWindow(scroll)
    if (view.searchCurrentId !== before && revealFindHit(scroll)) syncDiagramWindow(scroll)
    diagramState.findHooks.changed?.(scenarioId)
  })
}

/** Find's field, its payloads toggle, and Next and Previous. */
export function bindFind(diagram: Element, scroll: HTMLElement, id: string): void {
  const find = diagram.querySelector<HTMLInputElement>('[data-diagram-find]')
  let reveal: ReturnType<typeof setTimeout> | undefined
  // Payloads load the first time Find is used, so they are often ready before the first key.
  find?.addEventListener('focus', () => refreshPayloads(id))
  if (diagramView(id).query) refreshPayloads(id)
  find?.addEventListener('input', () => {
    diagramView(id).query = find.value
    refreshPayloads(id)
    updateSearchCurrent(id)
    syncFindControls(scroll)
    syncDiagramWindow(scroll)
    diagramState.findHooks.changed?.(id)
    // Typing on a phone has no Enter: bring the first match on screen once typing pauses.
    clearTimeout(reveal)
    reveal = setTimeout(() => {
      if (revealFindHit(scroll)) syncDiagramWindow(scroll)
    }, SEARCH_REVEAL_DELAY_MS)
  })
  diagram.querySelector<HTMLButtonElement>('[data-find-payloads]')?.addEventListener('click', (ev) => {
    const view = diagramView(id)
    view.includePayloads = !view.includePayloads
    const toggle = ev.currentTarget as HTMLButtonElement
    toggle.setAttribute('aria-pressed', String(view.includePayloads))
    find?.setAttribute('aria-label', findFieldLabel(view.includePayloads))
    refreshPayloads(id)
    updateSearchCurrent(id)
    syncFindControls(scroll)
    syncDiagramWindow(scroll)
    diagramState.findHooks.changed?.(id)
  })
  diagram.querySelectorAll<HTMLButtonElement>('[data-find-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearTimeout(reveal)
      stepFind(scroll, btn.dataset.findStep === 'prev' ? -1 : 1)
    })
  })
}
