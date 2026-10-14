import './styles/app.css'
import './styles/timing.css'
import './styles/diagram.css'
import { sampleReport } from './data/sample-report'
import type { MessageEvent, Report, Scenario, Status } from './types'
import { scenarioDescriptionHtml, scenarioHaystack } from './ui/scenario-summary'
import {
  bindInspector,
  delegateMessageOpen,
  inspectorMarkup,
  type InspectorController,
  type InspectorInvoker,
} from './ui/inspector'
import { loadExternalPayloads, payloadKey } from './lib/payloads'
import { parseReportHash, writeReportHash, type HashRef } from './lib/report-hash'
import { defaultScenarioId, reselect, stepSelection } from './ui/selection'
import { placePrintMetrics, printMetricsSection } from './ui/metrics'
import { timingPanelHtml, timingStripHtml } from './ui/timing'
import { placePrintPanel, printComponentsSection, printMessageSection } from './ui/print-panel'
import { renderComponentDiagram } from './lib/component-diagram'

declare global {
  interface Window {
    /** Set by lsd-mono-core ReportWriter before this bundle boots. Dev: assign before load to preview a capture. */
    __LSD_REPORT__?: Report
    /** Full message payloads, loaded when the inspector opens. Not part of the first paint. */
    __LSD_PAYLOADS__?: Record<string, unknown>
    /** Sibling script that assigns `__LSD_PAYLOADS__`. Relative to the report HTML. */
    __LSD_PAYLOADS_SRC__?: string
  }
}
import { diagramKeyAction, findOpensMessage, focusTargetAfterClose, messagePlaces } from './lib/diagram-a11y'
import {
  bindDiagramScroll,
  diagramView,
  findMessage,
  focusDiagramMessage,
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
  getSidebarCollapsed,
  navItemTooltip,
  sidebarToggleGlyph,
  sidebarToggleLabel,
  storeSidebarCollapsed,
} from './ui/sidebar'
import { DEFAULT_LABEL_MAX_WIDTH, formatGeneratedAt, statusLabel } from './ui/format'
import { componentGraph } from './lib/component-graph'
import { cssEscape, escapeAttr, escapeHtml } from './lib/escape'
import { trackTopbarHeight } from './lib/topbar-height'

interface State {
  query: string
  status: Record<Status, boolean>
  /** The scenario shown in the main column (#39). Kept while filters hide it all. */
  selectedId: string | null
  helpOpen: boolean
  sidebarCollapsed: boolean
}

const report: Report = window.__LSD_REPORT__ ?? sampleReport

const state: State = {
  query: '',
  status: { success: true, warn: true, error: true },
  selectedId: initialSelection(),
  helpOpen: false,
  sidebarCollapsed: getSidebarCollapsed(),
}

const app = document.querySelector('#app')!

/** The scenario in the URL (a link or a reload), otherwise the first in the list. */
function initialSelection(): string | null {
  const ref = parseReportHash(window.location.hash)
  if (ref && report.scenarios.some((s) => s.id === ref.scenarioId)) return ref.scenarioId
  return defaultScenarioId(report.scenarios)
}

/** Scenario whose card is in the main column now. Null while the empty state shows. */
let renderedId: string | null = null
/** True while a selection change closes the side panel: its focus return has nowhere to go. */
let switchingScenario = false
/** False until the URL hash has been read, so the first render cannot overwrite a #msg= link. */
let booted = false

/** Arrow, Metrics or Component diagram button that opened the inspector. Close returns focus here. */
let invoker: InspectorInvoker | null = null
let inspector: InspectorController | null = null
/** Scenario the side panel is showing, for its print copy. Errors have no invoker, so it is kept here. */
let panelScenarioId: string | null = null
/** Suppress hashchange while we write the hash ourselves. */
let writingHash = false
let stopTopbarTracking: () => void = () => {}

function reportLocation(): { hash: string; replace?: (url: string) => void } {
  return {
    get hash() {
      return window.location.hash
    },
    set hash(value: string) {
      window.location.hash = value.startsWith('#') ? value.slice(1) : value
    },
    replace(url: string) {
      try {
        const next = url === '#' || url === '' ? `${window.location.pathname}${window.location.search}` : url
        window.history.replaceState(null, '', next)
      } catch {
        window.location.hash = url.startsWith('#') ? url.slice(1) : url
      }
    },
  }
}

function writeHash(ref: HashRef | null): void {
  writingHash = true
  writeReportHash(reportLocation(), ref)
  writingHash = false
}

/** The URL names the shown scenario; an open message replaces it with #msg= (see openMessage). */
function writeScenarioHash(): void {
  writeHash(state.selectedId ? { scenarioId: state.selectedId } : null)
}

function counts() {
  return report.scenarios.reduce(
    (acc, s) => {
      acc[s.status]++
      return acc
    },
    { success: 0, warn: 0, error: 0 } as Record<Status, number>,
  )
}

function filtered(): Scenario[] {
  const q = state.query.trim().toLowerCase()
  return report.scenarios.filter((s) => {
    if (!state.status[s.status]) return false
    if (!q) return true
    const hay = scenarioHaystack(s).toLowerCase()
    return hay.includes(q)
  })
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
  const total = report.scenarios.length
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
        <input type="search" id="search" placeholder="Search scenarios, facts…" value="${escapeAttr(state.query)}" aria-label="Search scenarios" autocomplete="off"/>
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
      <aside class="sidebar" id="sidebar" aria-label="Scenarios">
        <div class="sidebar-head">
          <p class="sidebar-title">Scenarios · ${total}</p>
          <button type="button" class="icon-btn sidebar-toggle" id="btn-sidebar" aria-controls="sidebar"
            aria-expanded="${!state.sidebarCollapsed}" aria-label="${escapeAttr(sidebarToggleLabel(state.sidebarCollapsed))}"
            title="${escapeAttr(sidebarToggleLabel(state.sidebarCollapsed))}">${escapeHtml(sidebarToggleGlyph(state.sidebarCollapsed))}</button>
        </div>
        <div class="hist" aria-hidden="true" title="Status mix">
          <span class="s" style="width:${(c.success / total) * 100 || 0}%"></span>
          <span class="w" style="width:${(c.warn / total) * 100 || 0}%"></span>
          <span class="e" style="width:${(c.error / total) * 100 || 0}%"></span>
        </div>
        <ul class="scenario-nav" id="scenario-nav"></ul>
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

  stopTopbarTracking()
  stopTopbarTracking = trackTopbarHeight(document.querySelector<HTMLElement>('.topbar')!)
  bindChrome()
  renderNav()
  renderMain()
}

function bindChrome(): void {
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

  inspector = bindInspector(document, {
    loadPayload: (scenarioId, messageId) => loadMessagePayload(scenarioId, messageId),
    onContent: () => syncPrintPanel(),
    onClose: (opened) => {
      writeScenarioHash()
      panelScenarioId = null
      syncPrintCopies()
      if (switchingScenario) {
        invoker = null
        return
      }
      if (opened?.kind === 'components' || opened?.kind === 'metrics') {
        invoker = null
        const button = opened.kind === 'components' ? '[data-show-components]' : '[data-show-metrics]'
        document.querySelector<HTMLButtonElement>(`#card-${cssEscape(opened.scenarioId)} ${button}`)?.focus()
        return
      }
      const messageId = focusTargetAfterClose(opened?.messageId ?? null)
      const scenarioId = opened?.scenarioId
      invoker = null
      if (!messageId || !scenarioId) return
      const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(scenarioId)} .seq-scroll`)
      if (scroll) focusDiagramMessage(scroll, messageId)
    },
  })

  // Insight "show" buttons live in the Metrics view, outside the scenario card.
  document.querySelector<HTMLElement>('#inspector')!.addEventListener('click', (ev) => {
    const showMsg = (ev.target as Element | null)?.closest?.<HTMLButtonElement>('[data-show-message]')
    const scenarioId = showMsg?.dataset.scenarioId
    const messageId = showMsg?.dataset.showMessage
    if (scenarioId && messageId) revealMessage(scenarioId, messageId)
  })

  const main = document.querySelector<HTMLElement>('#main')!
  main.addEventListener('click', (ev) => {
    const target = ev.target as Element | null
    if (!target || !target.closest) return
    const jump = target.closest<HTMLButtonElement>('[data-jump-y]')
    if (jump) {
      const scroll = jump.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-scroll')
      if (scroll) scroll.scrollTop = Number(jump.dataset.jumpY)
      return
    }
    if (
      delegateMessageOpen(
        ev,
        (node) => messageFromNode(node),
        (scenarioId, message) => {
          const scenario = report.scenarios.find((item) => item.id === scenarioId)
          if (scenario) openMessage(scenario, message)
        },
      )
    ) {
      return
    }
    const componentsBtn = target.closest<HTMLButtonElement>('[data-show-components]')
    if (componentsBtn) {
      const scenario = report.scenarios.find((item) => item.id === componentsBtn.dataset.showComponents)
      if (scenario) openComponents(scenario)
      return
    }
    const metricsBtn = target.closest<HTMLButtonElement>('[data-show-metrics]')
    if (metricsBtn) {
      const scenario = report.scenarios.find((item) => item.id === metricsBtn.dataset.showMetrics)
      if (scenario) openMetrics(scenario)
      return
    }
    const errBtn = target.closest<HTMLButtonElement>('[data-show-error]')
    if (errBtn) {
      const scenario = report.scenarios.find((s) => s.id === errBtn.dataset.showError)
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
  })
  main.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement | null
    if (target?.matches('[data-diagram-find]') && ev.key === 'Enter') {
      const scenario = scenarioFrom(target)
      const scroll = target.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-scroll')
      if (scenario && scroll) {
        const messageId = findOpensMessage(
          scenario.events,
          (target as HTMLInputElement).value,
          diagramView(scenario.id).hidden,
        )
        const msg = messageId ? findMessage(scenario, messageId) : undefined
        if (msg) {
          ev.preventDefault()
          focusDiagramMessage(scroll, msg.id)
          openMessage(scenario, msg)
        }
      }
      return
    }
    const scrollKey = target?.closest?.<HTMLElement>('.seq-scroll')
    const openBtn = target?.closest?.<HTMLButtonElement>('button.msg-open')
    if (scrollKey && (openBtn || target === scrollKey)) {
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
          if (inspector?.isOpen()) {
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
  })
}

function renderNav(): void {
  const list = document.querySelector('#scenario-nav')!
  // Rebuilding the list drops focus; a nav button that had it gets it back (the selected one).
  const hadFocus = list.contains(document.activeElement)
  const items = filtered()
  list.innerHTML = items
    .map((s) => {
      const msgs = s.events.filter((e) => e.kind === 'message').length
      const number = report.scenarios.indexOf(s) + 1
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

function selectedNavButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('#scenario-nav [aria-current="true"]')
}

/**
 * Show one scenario. Focus stays where the user is: on the list when they chose
 * from it, otherwise on the new scenario's heading when the old card had focus.
 * The page scrolls back to the scenario's top.
 */
function selectScenario(id: string): void {
  if (!report.scenarios.some((s) => s.id === id)) return
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
  return `
    <div class="report-hero">
      <h1>${escapeHtml(report.title)}</h1>
      <div class="meta">
        <span>Generated ${escapeHtml(formatGeneratedAt(report.generatedAt))}</span>
        <code>${escapeHtml(report.generator)}</code>
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
  const items = filtered()
  const next = reselect(report.scenarios, items, state.selectedId)
  if (next !== state.selectedId && next) {
    state.selectedId = next
    renderNav()
  }
  const showId = next
  if (showId === renderedId && (showId === null ? main.querySelector('.empty') : main.querySelector('.scenario-card')))
    return

  // The side panel shows something from the scenario being replaced.
  if (inspector?.isOpen() && panelScenarioId !== showId) {
    switchingScenario = true
    inspector.close()
    switchingScenario = false
  }
  renderedId = showId
  const scenario = showId ? report.scenarios.find((s) => s.id === showId) : undefined
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
  if (booted && !panelScenarioId) writeScenarioHash()
  syncPrintCopies()
  bindDiagramScroll(main)
}

/** Scroll a scenario's diagram to a message. Shows that scenario first. */
function revealMessage(scenarioId: string, messageId: string): void {
  if (!report.scenarios.some((item) => item.id === scenarioId)) return
  if (renderedId !== scenarioId) selectScenario(scenarioId)
  const y = messageOffsetY(scenarioId, messageId)
  const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(scenarioId)} .seq-scroll`)
  if (!scroll || y == null) return
  scroll.closest('.seq-diagram')?.scrollIntoView({ block: 'nearest' })
  scroll.scrollTop = Math.max(0, y - 24)
  syncDiagramWindow(scroll)
}

function scenarioFrom(node: Element): Scenario | undefined {
  const card = node.closest<HTMLElement>('[id^="card-"]')
  if (!card) return
  return report.scenarios.find((s) => s.id === card.id.slice('card-'.length))
}

function scenarioHtml(s: Scenario): string {
  const labelMaxWidth = report.options?.labelMaxWidth ?? DEFAULT_LABEL_MAX_WIDTH
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
  if (!err || !inspector) return
  panelScenarioId = scenario.id
  invoker = null
  writeScenarioHash()
  inspector.openError({
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
  const view = inspector?.printView() ?? null
  const scenario = panelScenarioId ? report.scenarios.find((item) => item.id === panelScenarioId) : undefined
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
  const id = inspector?.isOpen() && invoker?.kind === 'metrics' ? invoker.scenarioId : null
  const scenario = id ? report.scenarios.find((item) => item.id === id) : undefined
  const labelMaxWidth = report.options?.labelMaxWidth ?? DEFAULT_LABEL_MAX_WIDTH
  placePrintMetrics(
    document,
    scenario
      ? {
          scenarioId: scenario.id,
          html: printMetricsSection(scenario.id, scenario.metrics, scenario.insights, labelMaxWidth),
        }
      : null,
  )
}

function openComponents(scenario: Scenario): void {
  if (!inspector) return
  panelScenarioId = scenario.id
  invoker = { scenarioId: scenario.id, kind: 'components' }
  writeScenarioHash()
  inspector.openComponents(scenario.id, componentGraph(scenario), scenario.title)
  syncPrintCopies()
}

function openMetrics(scenario: Scenario): void {
  if (!inspector) return
  panelScenarioId = scenario.id
  invoker = { scenarioId: scenario.id, kind: 'metrics' }
  writeScenarioHash()
  inspector.openMetrics(scenario.id, {
    heading: scenario.title,
    metrics: scenario.metrics,
    insights: scenario.insights,
    labelMaxWidth: report.options?.labelMaxWidth ?? DEFAULT_LABEL_MAX_WIDTH,
    timingHtml: timingPanelHtml(scenario),
  })
  syncPrintCopies()
}

function openMessage(scenario: Scenario, msg: MessageEvent): void {
  if (!inspector) return
  panelScenarioId = scenario.id
  invoker = { scenarioId: scenario.id, messageId: msg.id }
  writeHash({ scenarioId: scenario.id, messageId: msg.id })
  inspector.openMessage(scenario.id, msg)
  syncPrintCopies()
}

/**
 * Follow the URL hash (a link, a reload, an edited address or Back): show its scenario,
 * and open its message when it names one. Payload still loads on open.
 */
function applyHash(): void {
  if (writingHash) return
  const ref = parseReportHash(window.location.hash)
  if (!ref) return
  const scenario = report.scenarios.find((item) => item.id === ref.scenarioId)
  if (!scenario) return
  // A scenario the filters hide is shown anyway: the link asked for it.
  if (!filtered().some((s) => s.id === scenario.id)) {
    state.query = ''
    for (const s of ['success', 'warn', 'error'] as Status[]) state.status[s] = true
    const search = document.querySelector<HTMLInputElement>('#search')
    if (search) search.value = ''
    document.querySelectorAll('[data-filter]').forEach((btn) => btn.setAttribute('aria-pressed', 'true'))
  }
  if (renderedId !== scenario.id) selectScenario(scenario.id)
  if (!ref.messageId) return
  const msg = findMessage(scenario, ref.messageId)
  if (!msg) return
  const already = inspector?.isOpen() && invoker?.scenarioId === ref.scenarioId && invoker?.messageId === ref.messageId
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
  const map = await loadExternalPayloads(report === sampleReport)
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
    if (inspector?.isOpen()) return
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
  if (target.closest('.seq-minimap')) return
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
  if (e.key === 'Enter' && renderedId) {
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
renderShell()
applyHash()
booted = true
window.addEventListener('hashchange', () => applyHash())
window.addEventListener('keydown', onKey)
window.addEventListener('resize', () => {
  document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => {
    syncDiagramWindow(el)
  })
})
