// The main column: the selected scenario's card, or the empty state, and bringing a scenario or message into view.
import { renderNav, selectScenario } from './nav'
import { isStacked } from '../lib/media'
import { reselect } from '../ui/selection'
import { scrollDiagramToOffset } from '../lib/diagram/page-scroll'
import { bindDiagramScroll, diagramView, messageOffsetY, syncDiagramWindow } from '../lib/sequence-diagram'
import { cssEscape } from '../lib/escape'
import { heroHtml, scenarioHtml } from './scenario-card'
import { syncWithPanel } from './panel'
import { filtered } from './filters'
import { dropUnshownView, writeScenarioHash } from './url-hash'
import { bindComponentViews } from '../lib/component-view'
import { bindComponentZoom } from '../lib/component-zoom'
import {
  announceOpenedView,
  bindDiagramTabs,
  focusComponentView,
  openLink,
  pingShownView,
  showDiagramView,
} from './diagram-views'
import { index, session, state } from './context'
import { newerMinorNoticeHtml } from '../lib/schema-version'
export function focusScenarioHeading(): void {
  document.querySelector<HTMLElement>('#main .scenario-head h2')?.focus({ preventScroll: true })
}

/**
 * Wide layout: back to the top of the page, where the scenario starts. Narrow layout
 * (the list sits above it): to the scenario, below the sticky top bar.
 */
export function scrollToScenario(): void {
  const card = document.querySelector<HTMLElement>('#main .scenario-card')
  if (!card) return
  if (isStacked()) card.scrollIntoView({ block: 'start' })
  else window.scrollTo({ top: 0 })
}

/**
 * The main column shows the selected scenario alone. When search or the status filters
 * drop it, the next match is shown, or an empty state when nothing matches. Only a
 * different scenario is redrawn: typing in search does not rebuild the diagram.
 */
export function renderMain(): void {
  const main = document.querySelector('#main')!
  if (index && !session.reportId) {
    if (!session.loadingReportId) {
      main.innerHTML = `${newerMinorNoticeHtml(index.schemaVersion, 'index')}<div class="empty" role="status"><p>${index.reports.length ? 'Choose a report.' : 'No reports have been written to this directory yet.'}</p></div>`
    }
    return
  }
  const items = filtered()
  const next = reselect(session.report.scenarios, items, state.selectedId)
  if (next !== state.selectedId && next) {
    state.selectedId = next
    renderNav()
  }
  const showId = next
  if (
    showId === session.renderedId &&
    (showId === null ? main.querySelector('.empty') : main.querySelector('.scenario-card'))
  )
    return

  // The side panel shows something from the scenario being replaced.
  if (session.inspector?.isOpen() && session.panelScenarioId !== showId) {
    session.switchingScenario = true
    session.inspector.close()
    session.switchingScenario = false
  }
  session.renderedId = showId
  const scenario = showId ? session.report.scenarios.find((s) => s.id === showId) : undefined
  if (!scenario) {
    main.innerHTML = `${heroHtml()}
      <div class="empty" role="status">
        <p>No scenarios match your search and status filters.</p>
        <button type="button" class="text-btn" data-clear-filters>Clear filters</button>
      </div>`
    syncWithPanel()
    return
  }
  main.innerHTML = `${heroHtml()}${scenarioHtml(scenario)}`
  if (session.booted && !session.panelScenarioId) writeScenarioHash()
  else dropUnshownView()
  syncWithPanel()
  bindDiagramScroll(main)
  bindDiagramTabs(main)
  bindComponentViews(main, (scenarioId, edge) => openLink(scenarioId, edge))
  main.querySelectorAll<HTMLElement>('.comp-scroll').forEach(bindComponentZoom)
  pingShownView(main)
  announceOpenedView(main)
}

/** Scroll a scenario's diagram to a message. Shows that scenario first. */
export function revealMessage(scenarioId: string, messageId: string): void {
  if (!session.report.scenarios.some((item) => item.id === scenarioId)) return
  if (session.renderedId !== scenarioId) selectScenario(scenarioId)
  // A message is in the Sequence view.
  showDiagramView('sequence', false)
  const y = messageOffsetY(scenarioId, messageId)
  const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(scenarioId)} .seq-scroll`)
  if (!scroll || y == null) return
  scroll.closest('.seq-diagram')?.scrollIntoView({ block: 'nearest' })
  scrollDiagramToOffset(scroll, Math.max(0, y * diagramView(scenarioId).zoom - 24))
  syncDiagramWindow(scroll)
}

/** Enter: into the shown scenario's diagram, on its current message (or the diagram itself), or its first link. */
export function focusSelectedDiagram(): void {
  if (focusComponentView()) return
  const scroll = document.querySelector<HTMLElement>('#main .seq-scroll')
  if (!scroll) return
  const stop = scroll.querySelector<HTMLElement>('button.msg-open[tabindex="0"]') ?? scroll
  stop.focus()
}
