import './styles/app.css'
import './styles/diagram.css'
import { sampleReport } from './data/sample-report'
import type { MessageEvent, Report, Scenario, Status } from './types'
import { scenarioDescriptionHtml, scenarioHaystack } from './ui/scenario-summary'
import { bindInspector, delegateMessageOpen, inspectorMarkup, type InspectorController } from './ui/inspector'
import { loadExternalPayloads, payloadKey } from './lib/payloads'
import { clearMessageHash, parseMessageHash, writeMessageHash } from './lib/message-url'

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
import { applyTheme, getPreferredTheme, themeButtonLabel, themeGlyph, toggleTheme, type Theme } from './ui/theme'
import { DEFAULT_LABEL_MAX_WIDTH, formatGeneratedAt, statusLabel } from './ui/format'
import { insightsListHtml } from './ui/insights'

interface State {
  query: string
  status: Record<Status, boolean>
  openIds: Set<string>
  selectedId: string | null
  helpOpen: boolean
}

const report: Report = window.__LSD_REPORT__ ?? sampleReport

const state: State = {
  query: '',
  status: { success: true, warn: true, error: true },
  openIds: new Set([report.scenarios[0]?.id].filter(Boolean) as string[]),
  selectedId: report.scenarios[0]?.id ?? null,
  helpOpen: false,
}

const app = document.querySelector('#app')!

/** Arrow that opened the inspector. Close returns focus here. */
let invoker: { scenarioId: string; messageId: string } | null = null
let inspector: InspectorController | null = null
/** Suppress hashchange while we write the open-message token ourselves. */
let writingHash = false

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

function setOpenMessageHash(scenarioId: string, messageId: string): void {
  writingHash = true
  writeMessageHash(reportLocation(), { scenarioId, messageId })
  writingHash = false
}

function clearOpenMessageHash(): void {
  writingHash = true
  clearMessageHash(reportLocation())
  writingHash = false
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

function paintThemeButton(theme: Theme, btn: Element | null = document.querySelector('#btn-theme')): void {
  if (!btn) return
  const label = themeButtonLabel(theme)
  btn.textContent = themeGlyph(theme)
  btn.setAttribute('aria-label', label)
  btn.setAttribute('title', label)
}

function renderShell(): void {
  const c = counts()
  const total = report.scenarios.length
  const theme = getPreferredTheme()

  app.innerHTML = `
    <header class="topbar" role="banner">
      <div class="brand" title="Living Sequence Diagrams">
        <div class="brand-mark">LSD</div>
        <div>
          <div>Report Next</div>
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
            ${statusLabel(s)} <span class="count">${c[s]}</span>
          </button>`,
          )
          .join('')}
      </div>
      <div class="top-actions">
        <button type="button" class="icon-btn" id="btn-theme" title="${themeButtonLabel(theme)}" aria-label="${themeButtonLabel(theme)}">${themeGlyph(theme)}</button>
        <button type="button" class="icon-btn" id="btn-help" title="Keyboard shortcuts (?)" aria-label="Show keyboard help">?</button>
      </div>
    </header>
    <div class="shell">
      <aside class="sidebar" aria-label="Scenarios">
        <p class="sidebar-title">Scenarios · ${total}</p>
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
      <kbd>/</kbd> search · <kbd>j</kbd>/<kbd>k</kbd> next/prev scenario · <kbd>Enter</kbd> open/close<br/>
      In a diagram, <kbd>↑</kbd>/<kbd>↓</kbd> move between messages · <kbd>Enter</kbd> opens the side panel<br/>
      <kbd>d</kbd> theme (dark, light, high contrast) · <kbd>?</kbd> help · <kbd>Esc</kbd> close
    </div>
  `

  bindChrome()
  renderNav()
  renderMain()
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function bindChrome(): void {
  const search = document.querySelector<HTMLInputElement>('#search')!
  search.addEventListener('input', () => {
    state.query = search.value
    renderNav()
    renderMain()
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

  document.querySelector('#btn-help')!.addEventListener('click', () => {
    state.helpOpen = !state.helpOpen
    document.querySelector('#help')!.setAttribute('data-open', String(state.helpOpen))
  })

  inspector = bindInspector(document, {
    loadPayload: (scenarioId, messageId) => loadMessagePayload(scenarioId, messageId),
    onClose: (opened) => {
      clearOpenMessageHash()
      const messageId = focusTargetAfterClose(opened?.messageId ?? null)
      const scenarioId = opened?.scenarioId
      invoker = null
      if (!messageId || !scenarioId) return
      const scroll = document.querySelector<HTMLElement>(`#card-${CSS.escape(scenarioId)} .seq-scroll`)
      if (scroll) focusDiagramMessage(scroll, messageId)
    },
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
      delegateMessageOpen(ev, (node) => messageFromNode(node), (scenarioId, message) => {
        const scenario = report.scenarios.find((item) => item.id === scenarioId)
        if (scenario) openMessage(scenario, message)
      })
    ) {
      return
    }
    const showMsg = target.closest<HTMLButtonElement>('[data-show-message]')
    if (showMsg) {
      const scenario = scenarioFrom(showMsg)
      const messageId = showMsg.dataset.showMessage
      if (scenario && messageId) {
        const y = messageOffsetY(scenario.id, messageId)
        const scroll = document.querySelector<HTMLElement>(`#card-${scenario.id} .seq-scroll`)
        if (scroll && y != null) {
          scroll.scrollTop = Math.max(0, y - 24)
          syncDiagramWindow(scroll)
        }
      }
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
        const messageId = findOpensMessage(scenario.events, (target as HTMLInputElement).value, diagramView(scenario.id).hidden)
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
  const items = filtered()
  list.innerHTML = items
    .map((s) => {
      const msgs = s.events.filter((e) => e.kind === 'message').length
      return `
      <li>
        <button type="button" data-nav="${s.id}" aria-current="${state.selectedId === s.id}">
          <span class="dot ${s.status}"></span>
          <span>
            <div class="nav-title">${escapeHtml(s.title)}</div>
            <div class="nav-meta">${statusLabel(s.status)} · ${msgs} messages</div>
          </span>
        </button>
      </li>`
    })
    .join('')

  list.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.nav!
      state.selectedId = id
      state.openIds.add(id)
      renderNav()
      renderMain()
      document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
}

function renderMain(): void {
  const main = document.querySelector('#main')!
  const items = filtered()

  if (!items.length) {
    main.innerHTML = `
      <div class="report-hero">
        <h1>${escapeHtml(report.title)}</h1>
        <div class="meta">
          <span>Generated ${formatGeneratedAt(report.generatedAt)}</span>
          <code>${escapeHtml(report.generator)}</code>
        </div>
      </div>
      <div class="empty">No scenarios match your filters. Toggle status chips or clear search.</div>`
    return
  }

  main.innerHTML = `
    <div class="report-hero">
      <h1>${escapeHtml(report.title)}</h1>
      <div class="meta">
        <span>Generated ${formatGeneratedAt(report.generatedAt)}</span>
        <code>${escapeHtml(report.generator)}</code>
        <span>${items.length} shown</span>
      </div>
    </div>
    ${items.map((s, i) => scenarioHtml(s, i)).join('')}
    <p class="footer-note">
      Spike UI — custom SVG sequences, no PlantUML runtime.
      Domain model shaped after <a href="https://github.com/lsd-consulting/lsd-core" target="_blank" rel="noopener">lsd-core</a>.
    </p>`

  items.forEach((s) => {
    const card = document.getElementById(`card-${s.id}`)!
    const head = card.querySelector('.scenario-head')!
    head.addEventListener('click', () => toggleOpen(s.id))
    head.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggleOpen(s.id)
      }
    })

  })
  bindDiagramScroll(main)
}

function scenarioFrom(node: Element): Scenario | undefined {
  const card = node.closest<HTMLElement>('[id^="card-"]')
  if (!card) return
  return report.scenarios.find((s) => s.id === card.id.slice('card-'.length))
}

function toggleOpen(id: string): void {
  if (state.openIds.has(id)) state.openIds.delete(id)
  else state.openIds.add(id)
  state.selectedId = id
  renderNav()
  renderMain()
}

function scenarioHtml(s: Scenario, index: number): string {
  const open = state.openIds.has(s.id)
  const labelMaxWidth = report.options?.labelMaxWidth ?? DEFAULT_LABEL_MAX_WIDTH
  const diagram = renderDiagramHtml(s, labelMaxWidth)
  const insights = insightsListHtml(s.insights, labelMaxWidth)
  const metrics =
    s.metrics.length || insights
      ? `<section class="card">
          <h3>Metrics</h3>
          <dl class="kv">
            ${s.metrics.map((m) => `<dt>${escapeHtml(m.key)}</dt><dd>${escapeHtml(m.value)}</dd>`).join('')}
          </dl>
          ${insights}
        </section>`
      : ''
  return `
  <article class="scenario-card ${s.status}" id="card-${s.id}" data-open="${open}" data-status="${s.status}" style="animation-delay:${index * 40}ms">
    <div class="scenario-head" role="button" tabindex="0" aria-expanded="${open}">
      <span class="chev" aria-hidden="true">▸</span>
      <h2>${escapeHtml(s.title)}</h2>
      <span class="badge ${s.status}">${s.status}</span>
    </div>
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
        ${metrics}
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
  invoker = null
  clearOpenMessageHash()
  inspector.openError({
    status: scenario.status,
    headline: err.headline,
    message: err.message,
    stack: err.stack,
  })
}

function openMessage(scenario: Scenario, msg: MessageEvent): void {
  if (!inspector) return
  invoker = { scenarioId: scenario.id, messageId: msg.id }
  setOpenMessageHash(scenario.id, msg.id)
  inspector.openMessage(scenario.id, msg)
}

/** Open the message named in the URL hash (file:// safe). Payload still loads on open. */
function applyOpenMessageFromHash(): void {
  if (writingHash) return
  const ref = parseMessageHash(window.location.hash)
  if (!ref) return
  const scenario = report.scenarios.find((item) => item.id === ref.scenarioId)
  if (!scenario) return
  const msg = findMessage(scenario, ref.messageId)
  if (!msg) return
  const already =
    inspector?.isOpen() && invoker?.scenarioId === ref.scenarioId && invoker?.messageId === ref.messageId
  state.selectedId = scenario.id
  state.openIds.add(scenario.id)
  renderNav()
  renderMain()
  requestAnimationFrame(() => {
    const scroll = document.querySelector<HTMLElement>(`#card-${CSS.escape(scenario.id)} .seq-scroll`)
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

function visibleIds(): string[] {
  return filtered().map((s) => s.id)
}

function moveSelection(delta: number): void {
  const ids = visibleIds()
  if (!ids.length) return
  const cur = state.selectedId ? ids.indexOf(state.selectedId) : -1
  const next = ids[Math.max(0, Math.min(ids.length - 1, (cur < 0 ? 0 : cur) + delta))]
  state.selectedId = next
  state.openIds.add(next)
  renderNav()
  renderMain()
  document.getElementById(`card-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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
  if (target.closest('#inspector')) return
  if (target.closest('.seq-minimap')) return
  if (target.closest('.seq-scroll')) return

  if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#search')?.focus()
    return
  }
  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault()
    moveSelection(1)
    return
  }
  if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault()
    moveSelection(-1)
    return
  }
  if (e.key === 'Enter' && state.selectedId) {
    e.preventDefault()
    toggleOpen(state.selectedId)
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

applyTheme(getPreferredTheme())
renderShell()
applyOpenMessageFromHash()
window.addEventListener('hashchange', () => applyOpenMessageFromHash())
window.addEventListener('keydown', onKey)
window.addEventListener('resize', () => {
  document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => {
    syncDiagramWindow(el)
  })
})
