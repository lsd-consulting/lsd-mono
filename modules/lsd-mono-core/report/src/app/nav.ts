// The sidebar: the scenario list or the index page's report list, selection, and opening a report.
import { pingSource } from '../lib/usage-ping'
import type { Status } from '../types'
import { scenarioHaystack } from '../ui/scenario-summary'
import { loadReportData, type IndexManifest, type ReportData } from '../lib/report-index'
import { type HashRef } from '../lib/report-hash'
import { stepSelection } from '../ui/selection'
import { forgetDiagrams } from '../lib/sequence-diagram'
import { navFoldLabel, navItemTooltip } from '../ui/sidebar'
import { isStacked } from '../lib/media'
import { statusLabel } from '../ui/format'
import { indexNavHtml, orEmptyNavHtml } from '../ui/index-nav'
import { escapeAttr, escapeHtml } from '../lib/escape'
import { filtered, indexEntry } from './filters'
import { index, session, state } from './context'
import { focusScenarioHeading, renderMain, scrollToScenario } from './main-view'
import { applyRef } from './routing'
import { openingScenario } from './intents'
export function renderNav(): void {
  paintNavFold()
  if (index) {
    renderIndexNav(index)
    return
  }
  const list = document.querySelector('#scenario-nav')!
  // Rebuilding the list drops focus; a nav button that had it gets it back (the selected one).
  const hadFocus = list.contains(document.activeElement)
  const items = filtered()
  list.innerHTML = orEmptyNavHtml(
    items
      .map((s) => {
        const msgs = s.events.filter((e) => e.kind === 'message').length
        const number = session.report.scenarios.indexOf(s) + 1
        const tooltip = state.sidebarCollapsed
          ? ` title="${escapeAttr(navItemTooltip(s.title, statusLabel(s.status), msgs))}"`
          : ''
        return `
      <li>
        <button type="button" data-nav="${escapeAttr(s.id)}"${state.selectedId === s.id ? ' aria-current="true"' : ''} aria-controls="main"${tooltip}>
          <span class="dot ${escapeAttr(s.status)}"></span>
          <span class="nav-icon" aria-hidden="true">${number}</span>
          <span class="nav-text">
            <div class="nav-title">${escapeHtml(s.title)}</div>
            <div class="nav-meta">${escapeHtml(statusLabel(s.status))} · ${msgs} messages</div>
          </span>
        </button>
      </li>`
      })
      .join(''),
  )

  list.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      foldAfterChoosing()
      selectScenario(btn.dataset.nav!)
    })
  })
  if (hadFocus) selectedNavButton()?.focus()
}

/**
 * Narrow screens show only the selected item and an "N scenarios ▾" disclosure (CSS hides the
 * rest while the sidebar has nav-folded). A typed search lists every match instead.
 */
function paintNavFold(): void {
  const sidebar = document.querySelector('#sidebar')
  const toggle = document.querySelector<HTMLButtonElement>('#btn-nav-fold')
  if (!sidebar || !toggle) return
  const open = state.navOpen || state.query.trim() !== ''
  sidebar.classList.toggle('nav-folded', !open)
  toggle.setAttribute('aria-expanded', String(open))
  toggle.hidden = state.query.trim() !== ''
  const count = index ? index.reports.length : session.report.scenarios.length
  toggle.querySelector('.nav-fold-text')!.textContent = navFoldLabel(count, index ? 'report' : 'scenario')
  toggle.querySelector('.nav-fold-glyph')!.textContent = open ? '▴' : '▾'
}

/** Choosing an item on a narrow screen folds the list back to it. */
function foldAfterChoosing(): void {
  if (isStacked()) state.navOpen = false
}

/**
 * Index page: one group per report, failed reports first. A group lists its scenarios
 * when it is expanded (the open report always is) or while a search is typed. Choosing a
 * scenario in another report loads that report.
 */
function renderIndexNav(manifest: IndexManifest): void {
  const list = document.querySelector('#scenario-nav')!
  const hadFocus = list.contains(document.activeElement)
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.navKey
  const matchesLoaded = (scenarioId: string, q: string) => {
    const s = session.report.scenarios.find((item) => item.id === scenarioId)
    return s ? scenarioHaystack(s).toLowerCase().includes(q) : false
  }
  list.innerHTML = indexNavHtml(manifest, {
    reportId: session.reportId,
    selectedId: state.selectedId,
    expanded: state.expanded,
    query: state.query,
    status: state.status,
    collapsed: state.sidebarCollapsed,
    matchesLoaded,
  })

  list.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.group!
      if (state.expanded.has(id)) state.expanded.delete(id)
      else state.expanded.add(id)
      renderNav()
    })
  })
  list.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      foldAfterChoosing()
      const rid = btn.dataset.report!
      const sid = btn.dataset.nav!
      if (rid === session.reportId) selectScenario(sid)
      else void openReport(rid, { reportId: rid, scenarioId: sid })
    })
  })
  if (hadFocus) {
    const again = focusKey
      ? [...list.querySelectorAll<HTMLElement>('[data-nav-key]')].find((el) => el.dataset.navKey === focusKey)
      : null
    ;(again ?? selectedNavButton())?.focus()
  }
}

/**
 * Index page: load a report's data and show it, at the scenario (and message) the
 * reference names, else its first scenario. Shows a loading state meanwhile and an
 * error when the data script cannot be loaded.
 */
export async function openReport(id: string, ref?: HashRef, scroll = true): Promise<void> {
  const entry = indexEntry(id)
  if (!entry) return
  if (!entry.data) {
    window.location.href = entry.href
    return
  }
  session.loadingReportId = id
  state.expanded.add(id)
  const main = document.querySelector('#main')!
  if (session.reportId !== id) {
    main.innerHTML = `<div class="empty" role="status"><p>Loading ${escapeHtml(entry.title)}…</p></div>`
  }
  let data: ReportData
  try {
    data = await loadReportData(entry)
  } catch {
    if (session.loadingReportId !== id) return
    session.loadingReportId = null
    main.innerHTML = `<div class="empty" role="alert"><p>Could not load ${escapeHtml(entry.title)}. Its data file, <code>${escapeHtml(entry.data)}</code>, should be next to this page.</p></div>`
    return
  }
  if (session.loadingReportId !== id) return
  session.loadingReportId = null
  pingSource(data.report)
  if (session.reportId !== id) {
    if (session.inspector?.isOpen()) {
      session.switchingScenario = true
      session.inspector.close()
      session.switchingScenario = false
    }
    forgetDiagrams()
    session.report = data.report
    session.reportId = id
    session.reportPayloadsSrc = data.payloadsSrc
    session.renderedId = null
    document.title = `${session.report.title} · ${index?.title ?? 'LSD reports'}`
  }
  // The linked scenario, else a failed report's first failure, else the first scenario.
  const { wanted, selectedId } = openingScenario(session.report.scenarios, ref)
  state.selectedId = selectedId
  if (wanted) revealFiltered(wanted)
  renderNav()
  renderMain()
  if (scroll) scrollToScenario()
  if (ref?.messageId && wanted) applyRef({ scenarioId: wanted, messageId: ref.messageId })
}

/** A linked scenario the filters hide is shown anyway: clear them. */
export function revealFiltered(scenarioId: string): void {
  if (filtered().some((s) => s.id === scenarioId)) return
  state.query = ''
  for (const s of ['success', 'warn', 'error'] as Status[]) state.status[s] = true
  const search = document.querySelector<HTMLInputElement>('#search')
  if (search) search.value = ''
  document.querySelectorAll('[data-filter]').forEach((btn) => btn.setAttribute('aria-pressed', 'true'))
}

function selectedNavButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('#scenario-nav [aria-current="true"]')
}

/**
 * Show one scenario. Focus stays where the user is: on the list when they chose
 * from it, otherwise on the new scenario's heading when the old card had focus.
 * The page scrolls back to the scenario's top.
 */
export function selectScenario(id: string): void {
  if (!session.report.scenarios.some((s) => s.id === id)) return
  const main = document.querySelector('#main')!
  const focusInMain = main.contains(document.activeElement)
  state.selectedId = id
  renderNav()
  renderMain()
  if (focusInMain) focusScenarioHeading()
  scrollToScenario()
}

/** One step from `from` (the focused list item), or from the shown scenario. */
export function moveSelection(delta: number, from: string | null = state.selectedId): void {
  const next = stepSelection(filtered(), from, delta)
  if (!next) return
  if (next !== state.selectedId) selectScenario(next)
  // Stepping onto the scenario already shown still moves focus along the list.
  else if (document.querySelector('#scenario-nav')?.contains(document.activeElement)) selectedNavButton()?.focus()
}

export function focusedNavId(target: Element): string | null {
  return target.closest<HTMLElement>('#scenario-nav [data-nav]')?.dataset.nav ?? state.selectedId
}
