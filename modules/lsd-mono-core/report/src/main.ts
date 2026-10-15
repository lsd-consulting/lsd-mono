import './styles/app.css'
import './styles/timing.css'
import './styles/diagram.css'
import { sampleReport } from './data/sample-report'
import type { MessageEvent, Report, Scenario, Status } from './types'
import { scenarioDescriptionHtml, scenarioHaystack } from './ui/scenario-summary'
import { bindInspector, delegateMessageOpen, inspectorMarkup } from './ui/inspector'
import { loadExternalPayloads, loadPayloadsFrom, payloadKey } from './lib/payloads'
import { defaultReportId, loadReportData, type IndexManifest, type ReportData } from './lib/report-index'
import { parseReportHash, type HashRef } from './lib/report-hash'
import { defaultScenarioId, reselect, stepSelection } from './ui/selection'
import { placePrintMetrics, printMetricsSection } from './ui/metrics'
import { timingPanelHtml, timingStripHtml } from './ui/timing'
import { placePrintPanel, printComponentsSection, printMessageSection } from './ui/print-panel'
import { renderComponentDiagram } from './lib/component-diagram'
import { diagramKeyAction, findOpensMessage, focusTargetAfterClose, messagePlaces } from './lib/diagram-a11y'
import { scrollDiagramTo, scrollDiagramToOffset } from './lib/diagram/page-scroll'
import { revealSearchHit, updateSearchCurrent } from './lib/diagram/search-reveal'
import {
  bindDiagramScroll,
  diagramView,
  findMessage,
  focusDiagramMessage,
  forgetDiagrams,
  messageOffsetY,
  renderDiagramHtml,
  syncDiagramWindow,
} from './lib/sequence-diagram'
import {
  applyTheme,
  currentMode,
  followOsTheme,
  getPreferredTheme,
  themeButtonLabel,
  themeGlyph,
  toggleTheme,
  type Theme,
  type ThemeMode,
} from './ui/theme'
import {
  applySidebarCollapsed,
  navItemTooltip,
  sidebarToggleGlyph,
  sidebarToggleLabel,
  storeSidebarCollapsed,
} from './ui/sidebar'
import { DEFAULT_LABEL_MAX_WIDTH, formatGeneratedAt, statusLabel } from './ui/format'
import { componentGraph } from './lib/component-graph'
import { indexNavHtml } from './ui/index-nav'
import { cssEscape, escapeAttr, escapeHtml } from './lib/escape'
import { trackTopbarHeight } from './lib/topbar-height'
import { counts, filtered, indexEntry } from './app/filters'
import { writeHash, writeScenarioHash } from './app/url-hash'
import { index, session, state, app } from './app/context'

declare global {
  interface Window {
    /** Set by lsd-mono-core ReportWriter before this bundle boots. Dev: assign before load to preview a capture. */
    __LSD_REPORT__?: Report
    /** Full message payloads, loaded when the inspector opens. Not part of the first paint. */
    __LSD_PAYLOADS__?: Record<string, unknown>
    /** Sibling script that assigns `__LSD_PAYLOADS__`. Relative to the report HTML. */
    __LSD_PAYLOADS_SRC__?: string
    /** Set on the index page instead of `__LSD_REPORT__`: every report in the directory. */
    __LSD_INDEX__?: IndexManifest
    /** Filled by each `<stem>-report.js` as the index page opens reports. */
    __LSD_REPORTS__?: Record<string, ReportData>
  }
}

function paintThemeButton(
  { mode, theme }: { mode: ThemeMode; theme: Theme },
  btn: Element | null = document.querySelector('#btn-theme'),
): void {
  if (!btn) return
  const label = themeButtonLabel(mode, theme)
  btn.textContent = themeGlyph(mode)
  btn.setAttribute('aria-label', label)
  btn.setAttribute('title', label)
}

function renderShell(): void {
  const c = counts()
  const total = c.success + c.warn + c.error
  const theme = getPreferredTheme()
  const mode = currentMode()

  app.innerHTML = `
    <header class="topbar" role="banner">
      <div class="brand" title="Living Sequence Diagrams">
        <div class="brand-mark">LSD</div>
        <div>
          <div>Report</div>
          <div class="brand-sub">Living Sequence Diagrams</div>
        </div>
      </div>
      <div class="search-wrap">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="search" placeholder="${index ? 'Search reports, scenarios…' : 'Search scenarios, facts…'}" value="${escapeAttr(state.query)}" aria-label="Search scenarios" autocomplete="off"/>
        <span class="kbd">/</span>
      </div>
      <div class="filters" role="group" aria-label="Status filters">
        ${(['success', 'warn', 'error'] as Status[])
          .map(
            (s) => `
          <button type="button" class="chip ${s}" data-filter="${s}" aria-pressed="${state.status[s]}">
            ${escapeHtml(statusLabel(s))} <span class="count">${c[s]}</span>
          </button>`,
          )
          .join('')}
      </div>
      <div class="top-actions">
        <button type="button" class="icon-btn" id="btn-theme" title="${escapeAttr(themeButtonLabel(mode, theme))}" aria-label="${escapeAttr(themeButtonLabel(mode, theme))}">${escapeHtml(themeGlyph(mode))}</button>
        <button type="button" class="icon-btn" id="btn-help" title="Keyboard shortcuts (?)" aria-label="Show keyboard help">?</button>
      </div>
    </header>
    <div class="shell${state.sidebarCollapsed ? ' sidebar-collapsed' : ''}">
      <aside class="sidebar" id="sidebar" aria-label="${index ? 'Reports' : 'Scenarios'}">
        <div class="sidebar-head">
          <p class="sidebar-title">${index ? `Reports · ${index.reports.length} · ${total} scenarios` : `Scenarios · ${total}`}</p>
          <button type="button" class="icon-btn sidebar-toggle" id="btn-sidebar" aria-controls="sidebar"
            aria-expanded="${!state.sidebarCollapsed}" aria-label="${escapeAttr(sidebarToggleLabel(state.sidebarCollapsed))}"
            title="${escapeAttr(sidebarToggleLabel(state.sidebarCollapsed))}">${escapeHtml(sidebarToggleGlyph(state.sidebarCollapsed))}</button>
        </div>
        <div class="hist" aria-hidden="true" title="Status mix">
          <span class="s" style="width:${(c.success / total) * 100 || 0}%"></span>
          <span class="w" style="width:${(c.warn / total) * 100 || 0}%"></span>
          <span class="e" style="width:${(c.error / total) * 100 || 0}%"></span>
        </div>
        <ul class="scenario-nav${index ? ' index-nav' : ''}" id="scenario-nav"></ul>
      </aside>
      <main class="main" id="main"></main>
      ${inspectorMarkup()}
    </div>
    <div class="help-toast" id="help" data-open="false" role="note">
      <strong style="color:var(--text)">Keyboard</strong><br/>
      <kbd>/</kbd> search · <kbd>j</kbd>/<kbd>k</kbd> or <kbd>↓</kbd>/<kbd>↑</kbd> next/prev scenario · <kbd>Enter</kbd> go to its diagram<br/>
      In a diagram, <kbd>↑</kbd>/<kbd>↓</kbd> move between messages · <kbd>Enter</kbd> opens the side panel<br/>
      <kbd>d</kbd> theme (Auto follows the OS, dark, light, high contrast) · <kbd>?</kbd> help · <kbd>Esc</kbd> close
    </div>
  `

  session.stopTopbarTracking()
  session.stopTopbarTracking = trackTopbarHeight(document.querySelector<HTMLElement>('.topbar')!)
  bindChrome()
  renderNav()
  renderMain()
}

function bindChrome(): void {
  bindFilters()
  bindTopbarButtons()
  bindSidePanel()
  const main = document.querySelector<HTMLElement>('#main')!
  main.addEventListener('click', onMainClick)
  main.addEventListener('keydown', onMainKey)
}

/** Search, the status chips, and the empty state's Clear filters button. */
function bindFilters(): void {
  const search = document.querySelector<HTMLInputElement>('#search')!
  search.addEventListener('input', () => {
    state.query = search.value
    renderNav()
    renderMain()
  })
  // The empty state's Clear filters button.
  document.querySelector('#main')!.addEventListener('click', (ev) => {
    if (!(ev.target as Element).closest?.('[data-clear-filters]')) return
    state.query = ''
    search.value = ''
    for (const s of ['success', 'warn', 'error'] as Status[]) state.status[s] = true
    document.querySelectorAll('[data-filter]').forEach((btn) => btn.setAttribute('aria-pressed', 'true'))
    renderNav()
    renderMain()
    focusScenarioHeading()
  })

  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = btn.dataset.filter as Status
      state.status[s] = !state.status[s]
      btn.setAttribute('aria-pressed', String(state.status[s]))
      renderNav()
      renderMain()
    })
  })
}

/** Theme, collapse-sidebar and help buttons in the top bar. */
function bindTopbarButtons(): void {
  document.querySelector('#btn-theme')!.addEventListener('click', () => {
    paintThemeButton(toggleTheme())
  })

  document.querySelector('#btn-sidebar')!.addEventListener('click', () => {
    state.sidebarCollapsed = !state.sidebarCollapsed
    storeSidebarCollapsed(state.sidebarCollapsed)
    applySidebarCollapsed(
      document.querySelector('.shell'),
      document.querySelector('#btn-sidebar'),
      state.sidebarCollapsed,
    )
    renderNav()
    // Diagrams draw only the rows in view; the width just changed.
    document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((scrollport) => syncDiagramWindow(scrollport))
  })

  document.querySelector('#btn-help')!.addEventListener('click', () => {
    state.helpOpen = !state.helpOpen
    document.querySelector('#help')!.setAttribute('data-open', String(state.helpOpen))
  })
}

/** The side panel (inspector), and its Timing rows that reveal a message in the diagram. */
function bindSidePanel(): void {
  session.inspector = bindInspector(document, {
    loadPayload: (scenarioId, messageId) => loadMessagePayload(scenarioId, messageId),
    onContent: () => syncPrintPanel(),
    onClose: (opened) => {
      writeScenarioHash()
      session.panelScenarioId = null
      syncPrintCopies()
      if (session.switchingScenario) {
        session.invoker = null
        return
      }
      if (opened?.kind === 'components' || opened?.kind === 'metrics') {
        session.invoker = null
        const button = opened.kind === 'components' ? '[data-show-components]' : '[data-show-metrics]'
        document.querySelector<HTMLButtonElement>(`#card-${cssEscape(opened.scenarioId)} ${button}`)?.focus()
        return
      }
      const messageId = focusTargetAfterClose(opened?.messageId ?? null)
      const scenarioId = opened?.scenarioId
      session.invoker = null
      if (!messageId || !scenarioId) return
      const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(scenarioId)} .seq-scroll`)
      if (scroll) focusDiagramMessage(scroll, messageId)
    },
  })

  // Timing view rows (swim lanes, waterfall) live in the side panel, outside the scenario card.
  document.querySelector<HTMLElement>('#inspector')!.addEventListener('click', (ev) => {
    const showMsg = (ev.target as Element | null)?.closest?.<HTMLButtonElement>('[data-show-message]')
    const scenarioId = showMsg?.dataset.scenarioId
    const messageId = showMsg?.dataset.showMessage
    if (scenarioId && messageId) revealMessage(scenarioId, messageId)
  })
}

/** Clicks in the main column: section jumps, arrows, and the Components, Metrics and error buttons. */
function onMainClick(ev: MouseEvent): void {
  const target = ev.target as Element | null
  if (!target || !target.closest) return
  const jump = target.closest<HTMLButtonElement>('[data-jump-y]')
  if (jump) {
    const scroll = jump.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-scroll')
    if (scroll) scrollDiagramTo(scroll, Number(jump.dataset.jumpY))
    return
  }
  if (
    delegateMessageOpen(
      ev,
      (node) => messageFromNode(node),
      (scenarioId, message) => {
        const scenario = session.report.scenarios.find((item) => item.id === scenarioId)
        if (scenario) openMessage(scenario, message)
      },
    )
  ) {
    return
  }
  const componentsBtn = target.closest<HTMLButtonElement>('[data-show-components]')
  if (componentsBtn) {
    const scenario = session.report.scenarios.find((item) => item.id === componentsBtn.dataset.showComponents)
    if (scenario) openComponents(scenario)
    return
  }
  const metricsBtn = target.closest<HTMLButtonElement>('[data-show-metrics]')
  if (metricsBtn) {
    const scenario = session.report.scenarios.find((item) => item.id === metricsBtn.dataset.showMetrics)
    if (scenario) openMetrics(scenario)
    return
  }
  const errBtn = target.closest<HTMLButtonElement>('[data-show-error]')
  if (errBtn) {
    const scenario = session.report.scenarios.find((s) => s.id === errBtn.dataset.showError)
    if (scenario) openError(scenario)
    return
  }
  const hit = target.closest<SVGGElement>('.message.has-data')
  if (!hit) return
  const scenario = scenarioFrom(hit)
  const mid = hit.getAttribute('data-message-id')
  if (!scenario || !mid) return
  const msg = findMessage(scenario, mid)
  if (msg) openMessage(scenario, msg)
}

/** Keys in the main column: Enter in diagram find, diagram message navigation, and Enter on an arrow. */
function onMainKey(ev: KeyboardEvent): void {
  const target = ev.target as HTMLElement | null
  if (target?.matches('[data-diagram-find]') && ev.key === 'Enter') {
    onFindEnter(ev, target as HTMLInputElement)
    return
  }
  const scrollKey = target?.closest?.<HTMLElement>('.seq-scroll')
  const openBtn = target?.closest?.<HTMLButtonElement>('button.msg-open')
  if (scrollKey && (openBtn || target === scrollKey)) {
    onDiagramKey(ev, scrollKey, openBtn ?? null)
    return
  }
  const hit = target?.closest?.<SVGGElement>('.message.has-data')
  if (!hit) return
  if (ev.key !== 'Enter' && ev.key !== ' ') return
  ev.preventDefault()
  const scenario = scenarioFrom(hit)
  const mid = hit.getAttribute('data-message-id')
  if (!scenario || !mid) return
  const msg = findMessage(scenario, mid)
  if (msg) openMessage(scenario, msg)
}

/** Enter in a diagram's find box: open the first match and bring it on screen. */
function onFindEnter(ev: KeyboardEvent, target: HTMLInputElement): void {
  const scenario = scenarioFrom(target)
  const scroll = target.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-scroll')
  if (scenario && scroll) {
    const messageId = findOpensMessage(scenario.events, target.value, diagramView(scenario.id).hidden)
    const msg = messageId ? findMessage(scenario, messageId) : undefined
    ev.preventDefault()
    updateSearchCurrent(scenario.id)
    if (msg) diagramView(scenario.id).searchCurrentId = msg.id
    syncDiagramWindow(scroll)
    // A soft keyboard's Go / Search key sends Enter: close the keyboard so the match has the screen.
    if (matchMedia('(pointer: coarse)').matches) target.blur()
    if (msg) {
      focusDiagramMessage(scroll, msg.id)
      openMessage(scenario, msg)
    }
    if (revealSearchHit(scroll)) syncDiagramWindow(scroll)
  }
}

/** Up, Down and Enter on a diagram or its focused arrow. */
function onDiagramKey(ev: KeyboardEvent, scrollKey: HTMLElement, openBtn: HTMLButtonElement | null): void {
  const scenario = scenarioFrom(scrollKey)
  if (scenario) {
    const view = diagramView(scenario.id)
    const action = diagramKeyAction({
      key: ev.key,
      places: messagePlaces(scenario.events, view.hidden),
      activeId: openBtn?.dataset.messageId ?? view.activeMessageId,
      inDiagram: true,
    })
    if (action.type === 'move' && action.messageId) {
      ev.preventDefault()
      ev.stopPropagation()
      focusDiagramMessage(scrollKey, action.messageId)
      if (session.inspector?.isOpen()) {
        const msg = findMessage(scenario, action.messageId)
        if (msg) openMessage(scenario, msg)
      }
      return
    }
    if (action.type === 'open' && action.messageId) {
      ev.preventDefault()
      ev.stopPropagation()
      const msg = findMessage(scenario, action.messageId)
      if (msg) openMessage(scenario, msg)
      return
    }
    if (openBtn) ev.stopPropagation()
  }
}

function renderNav(): void {
  if (index) {
    renderIndexNav(index)
    return
  }
  const list = document.querySelector('#scenario-nav')!
  // Rebuilding the list drops focus; a nav button that had it gets it back (the selected one).
  const hadFocus = list.contains(document.activeElement)
  const items = filtered()
  list.innerHTML = items
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
    .join('')

  list.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => selectScenario(btn.dataset.nav!))
  })
  if (hadFocus) selectedNavButton()?.focus()
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
async function openReport(id: string, ref?: HashRef, scroll = true): Promise<void> {
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
  const wanted =
    ref?.scenarioId && session.report.scenarios.some((s) => s.id === ref.scenarioId) ? ref.scenarioId : null
  // A failed report opens at its first failure.
  state.selectedId =
    wanted ??
    session.report.scenarios.find((s) => s.status === 'error')?.id ??
    defaultScenarioId(session.report.scenarios)
  if (wanted) revealFiltered(wanted)
  renderNav()
  renderMain()
  if (scroll) scrollToScenario()
  if (ref?.messageId && wanted) applyRef({ scenarioId: wanted, messageId: ref.messageId })
}

/** A linked scenario the filters hide is shown anyway: clear them. */
function revealFiltered(scenarioId: string): void {
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
function selectScenario(id: string): void {
  if (!session.report.scenarios.some((s) => s.id === id)) return
  const main = document.querySelector('#main')!
  const focusInMain = main.contains(document.activeElement)
  state.selectedId = id
  renderNav()
  renderMain()
  if (focusInMain) focusScenarioHeading()
  scrollToScenario()
}

function focusScenarioHeading(): void {
  document.querySelector<HTMLElement>('#main .scenario-head h2')?.focus({ preventScroll: true })
}

/**
 * Wide layout: back to the top of the page, where the scenario starts. Narrow layout
 * (the list sits above it): to the scenario, below the sticky top bar.
 */
function scrollToScenario(): void {
  const card = document.querySelector<HTMLElement>('#main .scenario-card')
  if (!card) return
  if (matchMedia('(max-width: 860px)').matches) card.scrollIntoView({ block: 'start' })
  else window.scrollTo({ top: 0 })
}

function heroHtml(): string {
  const back = index
    ? `<p class="hero-index">${escapeHtml(index.title)} · report ${index.reports.findIndex((r) => r.id === session.reportId) + 1} of ${index.reports.length}</p>`
    : ''
  return `
    <div class="report-hero">
      ${back}
      <h1>${escapeHtml(session.report.title)}</h1>
      <div class="meta">
        <span>Generated ${escapeHtml(formatGeneratedAt(session.report.generatedAt))}</span>
        <code>${escapeHtml(session.report.generator)}</code>
      </div>
    </div>`
}

/**
 * The main column shows the selected scenario alone. When search or the status filters
 * drop it, the next match is shown, or an empty state when nothing matches. Only a
 * different scenario is redrawn: typing in search does not rebuild the diagram.
 */
function renderMain(): void {
  const main = document.querySelector('#main')!
  if (index && !session.reportId) {
    if (!session.loadingReportId) {
      main.innerHTML = `<div class="empty" role="status"><p>${index.reports.length ? 'Choose a report.' : 'No reports have been written to this directory yet.'}</p></div>`
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
    syncPrintCopies()
    return
  }
  main.innerHTML = `${heroHtml()}${scenarioHtml(scenario)}`
  if (session.booted && !session.panelScenarioId) writeScenarioHash()
  syncPrintCopies()
  bindDiagramScroll(main)
}

/** Scroll a scenario's diagram to a message. Shows that scenario first. */
function revealMessage(scenarioId: string, messageId: string): void {
  if (!session.report.scenarios.some((item) => item.id === scenarioId)) return
  if (session.renderedId !== scenarioId) selectScenario(scenarioId)
  const y = messageOffsetY(scenarioId, messageId)
  const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(scenarioId)} .seq-scroll`)
  if (!scroll || y == null) return
  scroll.closest('.seq-diagram')?.scrollIntoView({ block: 'nearest' })
  scrollDiagramToOffset(scroll, Math.max(0, y * diagramView(scenarioId).zoom - 24))
  syncDiagramWindow(scroll)
}

function scenarioFrom(node: Element): Scenario | undefined {
  const card = node.closest<HTMLElement>('[id^="card-"]')
  if (!card) return
  return session.report.scenarios.find((s) => s.id === card.id.slice('card-'.length))
}

function scenarioHtml(s: Scenario): string {
  const labelMaxWidth = session.report.options?.labelMaxWidth ?? DEFAULT_LABEL_MAX_WIDTH
  const diagram = renderDiagramHtml(s, labelMaxWidth)
  return `
  <article class="scenario-card ${escapeAttr(s.status)}" id="card-${escapeAttr(s.id)}" data-status="${escapeAttr(s.status)}" aria-labelledby="scenario-title">
    <div class="scenario-head">
      <h2 id="scenario-title" tabindex="-1">${escapeHtml(s.title)}</h2>
      <span class="badge ${escapeAttr(s.status)}">${escapeHtml(s.status)}</span>
    </div>
    ${timingStripHtml(s)}
    <div class="scenario-body">
      <div class="cards">
        <section class="card">
          <h3>Description</h3>
          ${scenarioDescriptionHtml(s)}
        </section>
        <section class="card">
          <h3>Key facts</h3>
          <dl class="kv">
            ${s.facts.map((f) => `<dt>${escapeHtml(f.key)}</dt><dd>${escapeHtml(f.value)}</dd>`).join('')}
          </dl>
        </section>
      </div>
      <section class="diagram-panel">
        <h3>
          Sequence diagram
          <span class="diagram-hint">Zoom and fit · hide participants · find labels · ↑↓ between messages</span>
        </h3>
        ${diagram}
      </section>
    </div>
  </article>`
}

function openError(scenario: Scenario): void {
  const err = scenario.error
  if (!err || !session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = null
  writeScenarioHash()
  session.inspector.openError({
    status: scenario.status,
    headline: err.headline,
    message: err.message,
    stack: err.stack,
  })
  syncPrintCopies()
}

/** Print copies of the side panel follow what it shows. The panel itself never prints. */
function syncPrintCopies(): void {
  syncPrintMetrics()
  syncPrintPanel()
}

/**
 * The message JSON, error, or component diagram open in the side panel prints in
 * its scenario, after the sequence diagram. A closed panel prints nothing.
 */
function syncPrintPanel(): void {
  const view = session.inspector?.printView() ?? null
  const scenario = session.panelScenarioId
    ? session.report.scenarios.find((item) => item.id === session.panelScenarioId)
    : undefined
  if (!view || !scenario || view.view === 'metrics') {
    placePrintPanel(document, null)
    return
  }
  if (view.view === 'components') {
    const drawn = renderComponentDiagram(componentGraph(scenario), scenario.title)
    placePrintPanel(document, { scenarioId: scenario.id, html: printComponentsSection(view, drawn.svg, drawn.width) })
    return
  }
  placePrintPanel(document, { scenarioId: scenario.id, html: printMessageSection(view) })
}

/**
 * Printed metrics follow the side panel: present only while it shows the Metrics
 * view, inside that scenario. Any other view, or a closed panel, prints none.
 */
function syncPrintMetrics(): void {
  const id = session.inspector?.isOpen() && session.invoker?.kind === 'metrics' ? session.invoker.scenarioId : null
  const scenario = id ? session.report.scenarios.find((item) => item.id === id) : undefined
  placePrintMetrics(
    document,
    scenario
      ? {
          scenarioId: scenario.id,
          html: printMetricsSection(scenario.id, scenario.metrics),
        }
      : null,
  )
}

function openComponents(scenario: Scenario): void {
  if (!session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = { scenarioId: scenario.id, kind: 'components' }
  writeScenarioHash()
  session.inspector.openComponents(scenario.id, componentGraph(scenario), scenario.title)
  syncPrintCopies()
}

function openMetrics(scenario: Scenario): void {
  if (!session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = { scenarioId: scenario.id, kind: 'metrics' }
  writeScenarioHash()
  session.inspector.openMetrics(scenario.id, {
    heading: scenario.title,
    metrics: scenario.metrics,
    timingHtml: timingPanelHtml(scenario),
  })
  syncPrintCopies()
}

function openMessage(scenario: Scenario, msg: MessageEvent): void {
  if (!session.inspector) return
  session.panelScenarioId = scenario.id
  session.invoker = { scenarioId: scenario.id, messageId: msg.id }
  writeHash({ scenarioId: scenario.id, messageId: msg.id })
  session.inspector.openMessage(scenario.id, msg)
  syncPrintCopies()
}

/**
 * Follow the URL hash (a link, a reload, an edited address or Back): show its scenario,
 * and open its message when it names one. Payload still loads on open.
 */
function applyHash(): void {
  if (session.writingHash) return
  const ref = parseReportHash(window.location.hash)
  if (index) {
    const id =
      ref?.reportId && indexEntry(ref.reportId) ? ref.reportId : session.reportId ? null : defaultReportId(index)
    if (id && id !== session.reportId) {
      // The first report opens where the page starts; a later link scrolls to its scenario.
      void openReport(id, ref ?? undefined, session.booted)
      return
    }
    if (!ref || ref.reportId !== session.reportId) return
  }
  if (!ref) return
  applyRef(ref)
}

/** Show the scenario a reference names in the open report, and open its message when it names one. */
function applyRef(ref: HashRef): void {
  const scenario = session.report.scenarios.find((item) => item.id === ref.scenarioId)
  if (!scenario) return
  // A scenario the filters hide is shown anyway: the link asked for it.
  revealFiltered(scenario.id)
  if (session.renderedId !== scenario.id) selectScenario(scenario.id)
  if (!ref.messageId) return
  const msg = findMessage(scenario, ref.messageId)
  if (!msg) return
  const already =
    session.inspector?.isOpen() &&
    session.invoker?.scenarioId === ref.scenarioId &&
    session.invoker?.messageId === ref.messageId
  requestAnimationFrame(() => {
    const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(scenario.id)} .seq-scroll`)
    if (scroll) focusDiagramMessage(scroll, msg.id)
    if (!already) openMessage(scenario, msg)
  })
}

function messageFromNode(node: Element): { scenarioId: string; message: MessageEvent } | null {
  const scenario = scenarioFrom(node)
  const messageId = node.getAttribute('data-message-id')
  if (!scenario || !messageId) return null
  const message = findMessage(scenario, messageId)
  if (!message) return null
  return { scenarioId: scenario.id, message }
}

async function loadMessagePayload(scenarioId: string, messageId: string): Promise<unknown> {
  const map = index
    ? session.reportPayloadsSrc
      ? await loadPayloadsFrom(session.reportPayloadsSrc)
      : {}
    : await loadExternalPayloads(session.report === sampleReport)
  const key = payloadKey(scenarioId, messageId)
  if (key in map) return map[key]
  return undefined
}

/** One step from `from` (the focused list item), or from the shown scenario. */
function moveSelection(delta: number, from: string | null = state.selectedId): void {
  const next = stepSelection(filtered(), from, delta)
  if (!next) return
  if (next !== state.selectedId) selectScenario(next)
  // Stepping onto the scenario already shown still moves focus along the list.
  else if (document.querySelector('#scenario-nav')?.contains(document.activeElement)) selectedNavButton()?.focus()
}

/** Enter: into the shown scenario's diagram, on its current message (or the diagram itself). */
function focusSelectedDiagram(): void {
  const scroll = document.querySelector<HTMLElement>('#main .seq-scroll')
  if (!scroll) return
  const stop = scroll.querySelector<HTMLElement>('button.msg-open[tabindex="0"]') ?? scroll
  stop.focus()
}

function focusedNavId(target: Element): string | null {
  return target.closest<HTMLElement>('#scenario-nav [data-nav]')?.dataset.nav ?? state.selectedId
}

function onKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement
  const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

  if (e.key === 'Escape') {
    if (session.inspector?.isOpen()) return
    if (state.helpOpen) {
      state.helpOpen = false
      document.querySelector('#help')!.setAttribute('data-open', 'false')
      e.preventDefault()
      return
    }
    if (typing) {
      ;(target as HTMLInputElement).blur()
      e.preventDefault()
    }
    return
  }

  if (typing) return
  if (target.closest('button.msg-open')) return
  if (target.closest('[data-show-components]')) return
  if (target.closest('[data-show-metrics]')) return
  if (target.closest('#inspector')) return
  if (target.closest('.seq-scroll')) return

  if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#search')?.focus()
    return
  }
  // j/k anywhere outside a text box; arrows only on the list, the page or the scenario
  // heading, so they keep their own meaning in the diagram toolbar and its popovers.
  // On the list, focus follows the selection.
  const arrows = target === document.body || target.closest('#scenario-nav') || target.matches('#scenario-title')
  if (e.key === 'j' || (e.key === 'ArrowDown' && arrows)) {
    e.preventDefault()
    moveSelection(1, focusedNavId(target))
    return
  }
  if (e.key === 'k' || (e.key === 'ArrowUp' && arrows)) {
    e.preventDefault()
    moveSelection(-1, focusedNavId(target))
    return
  }
  // Enter on a focused button presses that button (a list item, filters, theme…).
  // Anywhere else it goes into the shown scenario's diagram.
  if (e.key === 'Enter' && target.closest('button, a, [role="slider"]')) return
  if (e.key === 'Enter' && session.renderedId) {
    e.preventDefault()
    focusSelectedDiagram()
    return
  }
  if (e.key === 'd') {
    e.preventDefault()
    paintThemeButton(toggleTheme())
    return
  }
  if (e.key === '?') {
    e.preventDefault()
    state.helpOpen = !state.helpOpen
    document.querySelector('#help')!.setAttribute('data-open', String(state.helpOpen))
  }
}

// The head script already set it before first paint; this keeps the two in step.
applyTheme(getPreferredTheme())
followOsTheme((theme) => paintThemeButton({ mode: 'auto', theme }))
if (index) document.title = index.title
renderShell()
applyHash()
session.booted = true
window.addEventListener('hashchange', () => applyHash())
window.addEventListener('keydown', onKey)
window.addEventListener('resize', () => {
  document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => {
    syncDiagramWindow(el)
  })
})
