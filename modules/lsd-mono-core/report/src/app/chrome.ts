// The page shell (top bar, sidebar, main column, side panel) and its event listeners.
import { renderMain, revealMessage, focusScenarioHeading } from './main-view'
import { isCoarsePointer } from '../lib/media'
import { renderNav } from './nav'
import type { Status } from '../types'
import { bindInspector, delegateMessageOpen, inspectorMarkup } from '../ui/inspector'
import { diagramKeyAction, focusTargetAfterClose, messagePlaces } from '../lib/diagram-a11y'
import { scrollDiagramTo } from '../lib/diagram/page-scroll'
import { findStepKey } from '../lib/diagram/search-reveal'
import { diagramView, findMessage, focusDiagramMessage, stepFind, syncDiagramWindow } from '../lib/sequence-diagram'
import {
  currentMode,
  getPreferredTheme,
  themeButtonLabel,
  themeGlyph,
  toggleTheme,
  type Theme,
  type ThemeMode,
} from '../ui/theme'
import { applySidebarCollapsed, sidebarToggleGlyph, sidebarToggleLabel, storeSidebarCollapsed } from '../ui/sidebar'
import { statusLabel } from '../ui/format'
import { cssEscape, escapeAttr, escapeHtml } from '../lib/escape'
import { trackTopbarHeight } from '../lib/topbar-height'
import {
  scenarioFrom,
  openError,
  syncPrintCopies,
  syncPrintPanel,
  openComponents,
  openMetrics,
  openMessage,
  messageFromNode,
  loadMessagePayload,
} from './panel'
import { counts } from './filters'
import { writeScenarioHash } from './url-hash'
import { index, session, state, app } from './context'
export function paintThemeButton(
  { mode, theme }: { mode: ThemeMode; theme: Theme },
  btn: Element | null = document.querySelector('#btn-theme'),
): void {
  if (!btn) return
  const label = themeButtonLabel(mode, theme)
  btn.textContent = themeGlyph(mode)
  btn.setAttribute('aria-label', label)
  btn.setAttribute('title', label)
}

export function renderShell(): void {
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
      In Find, <kbd>Enter</kbd>/<kbd>Shift</kbd>+<kbd>Enter</kbd> (or <kbd>F3</kbd>) next/previous match<br/>
      <kbd>d</kbd> theme (Auto follows the OS, dark, light, high contrast) · <kbd>?</kbd> help · <kbd>Esc</kbd> close
    </div>
  `

  session.stopTopbarTracking()
  session.stopTopbarTracking = trackTopbarHeight(document.querySelector<HTMLElement>('.topbar')!)
  bindChrome()
  renderNav()
  renderMain()
}

export function bindChrome(): void {
  bindFilters()
  bindTopbarButtons()
  bindSidePanel()
  const main = document.querySelector<HTMLElement>('#main')!
  main.addEventListener('click', onMainClick)
  main.addEventListener('keydown', onMainKey)
}

/** Search, the status chips, and the empty state's Clear filters button. */
export function bindFilters(): void {
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
export function bindTopbarButtons(): void {
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
export function bindSidePanel(): void {
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
export function onMainClick(ev: MouseEvent): void {
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

/** Keys in the main column: stepping in diagram find, diagram message navigation, and Enter on an arrow. */
export function onMainKey(ev: KeyboardEvent): void {
  const target = ev.target as HTMLElement | null
  const step = target?.matches('[data-diagram-find]') ? findStepKey(ev) : null
  if (step) {
    onFindKey(ev, target as HTMLInputElement, step)
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

/** A step key in a diagram's find box: go to the next or previous match, wrapping, and bring it on screen. */
export function onFindKey(ev: KeyboardEvent, target: HTMLInputElement, step: 1 | -1): void {
  const scroll = target.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-scroll')
  if (!scroll) return
  ev.preventDefault()
  // A soft keyboard's Go / Search key sends Enter: close the keyboard so the match has the screen.
  if (ev.key === 'Enter' && isCoarsePointer()) target.blur()
  stepFind(scroll, step)
}

/** Up, Down and Enter on a diagram or its focused arrow. */
export function onDiagramKey(ev: KeyboardEvent, scrollKey: HTMLElement, openBtn: HTMLButtonElement | null): void {
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
