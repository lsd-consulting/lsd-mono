// The page shell (top bar, sidebar, main column, side panel) and its event listeners.
import { renderMain, revealMessage, focusScenarioHeading } from './main-view'
import { showInSequence } from './diagram-views'
import { renderNav } from './nav'
import type { Status } from '../types'
import { keyHelpHtml, singleKeysLabelHtml } from '../lib/keys/bindings'
import { setSingleKeys, singleKeysEnabled } from '../ui/shortcuts'
import { bindInspector, delegateMessageOpen, inspectorMarkup } from '../ui/inspector'
import { scrollDiagramTo } from '../lib/diagram/page-scroll'
import { setPayloadLoader } from '../lib/diagram/payload-find'
import { focusDiagramMessage, setFindHooks, syncDiagramWindow } from '../lib/sequence-diagram'
import { currentMode, getPreferredTheme } from '../ui/theme'
import { bindThemeMenu, themeControlHtml } from '../ui/theme-menu'
import { bindHelpDialog, helpDialogHtml } from '../ui/help-dialog'
import {
  applySidebarCollapsed,
  sidebarTitleText,
  sidebarToggleGlyph,
  sidebarToggleLabel,
  storeSidebarCollapsed,
} from '../ui/sidebar'
import { statusGlyph, statusLabel } from '../ui/format'
import { statusDefinitionId, statusLegendHtml } from '../ui/status-legend'
import { cssEscape, escapeAttr, escapeHtml } from '../lib/escape'
import { searchStatusText } from '../ui/search-status'
import { searchOriginAfter } from './search-origin'
import { clearField } from './keys'
import { trackTopbarHeight } from '../lib/topbar-height'
import { repoLinkAttrsHtml } from '../ui/repo-link'
import { revealSideways } from '../lib/reveal'
import {
  openError,
  syncWithPanel,
  syncPrintPanel,
  openMetrics,
  openMessage,
  messageFromNode,
  loadMessagePayload,
  loadPayloadMap,
  followFind,
  panelFindQuery,
  refreshPanelFind,
} from './panel'
import { counts, filtered } from './filters'
import { writeScenarioHash } from './url-hash'
import { index, session, state, app } from './context'
import { mainClick } from './intents'
import { openFromDiagram } from './diagram-keys'
export function renderShell(): void {
  const c = counts()
  const total = c.success + c.warn + c.error
  const theme = getPreferredTheme()
  const mode = currentMode()

  // The keyboard help comes right after the top bar, whose last control is ?, so Tab goes from ?
  // into the help and on to the sidebar (#112). Not inside the bar: its backdrop filter would make
  // it the box the fixed dialog is placed in.
  app.innerHTML = `
    <header class="topbar" role="banner">
      <div class="brand">
        <a class="brand-mark repo-link" ${repoLinkAttrsHtml('Living Sequence Diagrams: lsd-mono on GitHub')}>LSD</a>
        <div>
          <div>Report</div>
          <div class="brand-sub">Living Sequence Diagrams</div>
        </div>
      </div>
      <div class="search-wrap">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="search" placeholder="${index ? 'Search reports, scenarios…' : 'Search scenarios, facts…'}" value="${escapeAttr(state.query)}" aria-label="Search scenarios" autocomplete="off"/>
        <button type="button" class="search-clear" id="search-clear" aria-label="Clear search" title="Clear search"${state.query ? '' : ' hidden'}>×</button>
        <span class="kbd"${state.query ? ' hidden' : ''}>/</span>
        <span class="visually-hidden" id="search-status" role="status" aria-live="polite"></span>
      </div>
      <div class="filters" role="group" aria-label="Status filters">
        ${(['success', 'warn', 'error'] as Status[])
          .map(
            (s) => `
          <button type="button" class="chip ${s}" data-filter="${s}" aria-pressed="${state.status[s]}" aria-describedby="${escapeAttr(statusDefinitionId(s))}">
            <span class="chip-glyph" aria-hidden="true">${escapeHtml(statusGlyph(s))}</span><span class="chip-label">${escapeHtml(statusLabel(s))}</span> <span class="count">${c[s]}</span>
          </button>`,
          )
          .join('')}
        ${statusLegendHtml()}
      </div>
      <div class="top-actions">
        ${themeControlHtml(mode, theme)}
        <button type="button" class="icon-btn" id="btn-help" title="Keyboard shortcuts (?)" aria-label="Show keyboard help">?</button>
      </div>
    </header>
    ${helpDialogHtml(`
      <p class="help-keys">${keyHelpHtml()}</p>
      <label class="help-setting"><input type="checkbox" id="single-keys"${singleKeysEnabled() ? ' checked' : ''}/> <span class="help-setting-text">${singleKeysLabelHtml()}</span></label>`)}
    <div class="shell${state.sidebarCollapsed ? ' sidebar-collapsed' : ''}">
      <aside class="sidebar" id="sidebar" aria-label="${index ? 'Reports' : 'Scenarios'}">
        <div class="sidebar-head">
          <button type="button" class="nav-fold" id="btn-nav-fold" aria-controls="scenario-nav" aria-expanded="false"><span class="nav-fold-text"></span> <span class="nav-fold-glyph" aria-hidden="true">▾</span></button>
          <p class="sidebar-title">${index ? `Reports · ${index.reports.length} · ${total} scenarios` : escapeHtml(sidebarTitleText(total))}</p>
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
  `

  session.stopTopbarTracking()
  session.stopTopbarTracking = trackTopbarHeight(document.querySelector<HTMLElement>('.topbar')!)
  bindChrome()
  renderNav()
  renderMain()
}

function bindChrome(): void {
  bindFilters()
  bindStatusLegend()
  bindTopbarButtons()
  bindSidePanel()
  const main = document.querySelector<HTMLElement>('#main')!
  main.addEventListener('click', onMainClick)
  // On a phone the timing chips are one row that scrolls sideways: a focused chip comes wholly into it.
  main.addEventListener('focusin', (ev) => {
    const target = ev.target as Element
    const strip = target.closest?.<HTMLElement>('.timing-strip')
    if (strip) revealSideways(strip, target)
  })
}

/** Search, the status chips, and the empty state's Clear filters button. */
function bindFilters(): void {
  const search = document.querySelector<HTMLInputElement>('#search')!
  const clear = document.querySelector<HTMLButtonElement>('#search-clear')!
  const slash = search.parentElement!.querySelector<HTMLElement>('.kbd')
  const status = document.querySelector<HTMLElement>('#search-status')!
  let announce: ReturnType<typeof setTimeout> | undefined
  search.addEventListener('input', () => {
    const before = state.query
    state.query = search.value
    const back = searchOriginAfter(before, state.query, state.selectedId)
    if (back) state.selectedId = back
    clear.hidden = search.value === ''
    if (slash) slash.hidden = search.value !== ''
    renderNav()
    renderMain()
    // The count, once typing pauses, so a screen reader is not read every keystroke.
    clearTimeout(announce)
    if (index) return
    announce = setTimeout(() => {
      status.textContent = searchStatusText(
        filtered().length,
        session.report.scenarios.length,
        state.query.trim() !== '',
      )
    }, 500)
  })
  clear.addEventListener('click', () => {
    clearField(search)
    search.focus()
  })
  // The empty state's Clear filters button.
  document.querySelector('#main')!.addEventListener('click', (ev) => {
    if (!(ev.target as Element).closest?.('[data-clear-filters]')) return
    state.query = ''
    search.value = ''
    clear.hidden = true
    if (slash) slash.hidden = false
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

/** The "?" by the status chips opens what each status means (#163); Esc or a click away closes it. */
function bindStatusLegend(): void {
  const btn = document.querySelector<HTMLButtonElement>('#btn-status-legend')
  const legend = document.querySelector<HTMLElement>('#status-legend')
  if (!btn || !legend) return
  const show = (open: boolean) => {
    legend.hidden = !open
    btn.setAttribute('aria-expanded', String(open))
  }
  btn.addEventListener('click', () => show(Boolean(legend.hidden)))
  for (const el of [btn, legend]) {
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' || legend.hidden) return
      ev.preventDefault()
      ev.stopPropagation()
      show(false)
      btn.focus()
    })
  }
  document.addEventListener('click', (ev) => {
    const target = ev.target as Node
    if (!legend.hidden && !legend.contains(target) && !btn.contains(target)) show(false)
  })
}

/** Theme, collapse-sidebar and help buttons in the top bar. */
function bindTopbarButtons(): void {
  bindThemeMenu()

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

  document.querySelector('#btn-nav-fold')!.addEventListener('click', () => {
    state.navOpen = !state.navOpen
    renderNav()
  })

  document.querySelector<HTMLInputElement>('#single-keys')!.addEventListener('change', (ev) => {
    setSingleKeys((ev.currentTarget as HTMLInputElement).checked)
  })

  session.help = bindHelpDialog(document)
}

/** The side panel (inspector), and its Timing rows that reveal a message in the diagram. */
function bindSidePanel(): void {
  setPayloadLoader(() => loadPayloadMap())
  setFindHooks({ changed: refreshPanelFind, stepped: followFind })
  session.inspector = bindInspector(document, {
    loadPayload: (scenarioId, messageId) => loadMessagePayload(scenarioId, messageId),
    findQuery: panelFindQuery,
    onContent: () => syncPrintPanel(),
    onClose: (_opened, returned) => {
      writeScenarioHash()
      session.panelScenarioId = null
      syncWithPanel()
      // Another scenario is about to show: it decides focus.
      const focus = session.switchingScenario ? { kind: 'none' as const } : returned
      session.invoker = null
      if (focus.kind === 'button') {
        // The toolbar button, unless Metrics was opened from a timing chip: those carry
        // data-show-metrics too, and the first of them is far up the page.
        const card = document.querySelector<HTMLElement>(`#card-${cssEscape(focus.scenarioId)}`)
        const chip = focus.chip != null ? card?.querySelectorAll<HTMLElement>('.timing-chip')[focus.chip] : undefined
        ;(chip ?? card?.querySelector<HTMLElement>(focus.selector))?.focus()
      } else if (focus.kind === 'message') {
        const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(focus.scenarioId)} .seq-scroll`)
        if (scroll) focusDiagramMessage(scroll, focus.messageId)
      }
    },
  })

  // Timing view rows (swim lanes, waterfall) and a link's "Show in sequence" (#105) live in the
  // side panel, outside the scenario card.
  document.querySelector<HTMLElement>('#inspector')!.addEventListener('click', (ev) => {
    const inSequence = (ev.target as Element | null)?.closest?.<HTMLButtonElement>('[data-show-in-sequence]')
    if (inSequence?.dataset.scenarioId && inSequence.dataset.showInSequence) {
      showInSequence(inSequence.dataset.scenarioId, inSequence.dataset.showInSequence)
      return
    }
    const showMsg = (ev.target as Element | null)?.closest?.<HTMLButtonElement>('[data-show-message]')
    const scenarioId = showMsg?.dataset.scenarioId
    const messageId = showMsg?.dataset.showMessage
    if (scenarioId && messageId) revealMessage(scenarioId, messageId)
  })
}

/** Clicks in the main column: section jumps, arrows, and the Metrics and error buttons. */
function onMainClick(ev: MouseEvent): void {
  const click = mainClick(ev.target as Element | null)
  if (click?.kind === 'jump') {
    scrollDiagramTo(click.scroll, click.y)
    return
  }
  const opened = delegateMessageOpen(
    ev,
    (node) => messageFromNode(node),
    (scenarioId, message) => {
      const scenario = scenarioById(scenarioId)
      if (scenario) openMessage(scenario, message)
    },
  )
  if (opened || !click) return
  switch (click.kind) {
    case 'close-panel': {
      session.inspector?.close()
      click.button.focus()
      return
    }
    case 'metrics': {
      const scenario = scenarioById(click.scenarioId)
      if (scenario) openMetrics(scenario, click.section, click.chip)
      return
    }
    case 'error': {
      const scenario = scenarioById(click.scenarioId)
      if (scenario) openError(scenario)
      return
    }
    case 'message':
      openFromDiagram(click.hit, click.messageId)
  }
}

const scenarioById = (id: string | undefined) => session.report.scenarios.find((item) => item.id === id)
