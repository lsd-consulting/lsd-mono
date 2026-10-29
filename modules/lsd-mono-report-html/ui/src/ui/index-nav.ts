import { escapeAttr, escapeHtml } from '../lib/escape'
import { visibleScenarios, type IndexManifest, type IndexReport, type IndexScenario } from '../lib/report-index'
import type { Status } from '../types'
import { statusDotHtml, statusLabel } from './format'
import { navItemTooltip } from './sidebar'

export interface IndexNavState {
  /** The open report. */
  reportId: string | null
  /** The scenario shown, in the open report. */
  selectedId: string | null
  /** Reports whose scenarios are listed. */
  expanded: ReadonlySet<string>
  query: string
  status: Record<Status, boolean>
  /** The sidebar is an icon rail: names move into tooltips. */
  collapsed: boolean
  /** Search on the open report's loaded data (facts, descriptions), not only titles. */
  matchesLoaded?: (scenarioId: string, query: string) => boolean
}

/**
 * The index page's sidebar: one group per report, in manifest order (failed reports
 * first). A group lists its scenarios when it is expanded or while a search is typed;
 * a group with no matching scenario is left out. An entry without a data script is a link
 * to its own page.
 */
export function indexNavHtml(manifest: IndexManifest, state: IndexNavState): string {
  const searching = state.query.trim() !== ''
  const filter = { query: state.query, status: state.status }
  const html = manifest.reports
    .map((r) => {
      const shown = visibleScenarios(r, filter, r.id === state.reportId ? state.matchesLoaded : undefined)
      if (!shown.length && (searching || r.scenarios.length)) return ''
      return groupHtml(r, shown, searching || state.expanded.has(r.id), state)
    })
    .join('')
  return html.trim() ? html : '<li class="nav-empty">No reports match.</li>'
}

/** "1 error · 2 success": the report's scenarios by outcome, failures first. */
export function outcomeSummary(counts: Record<Status, number>): string {
  return (['error', 'warn', 'success'] as Status[])
    .filter((st) => counts[st])
    .map((st) => `${counts[st]} ${statusLabel(st).toLowerCase()}`)
    .join(' · ')
}

function groupHtml(r: IndexReport, shown: IndexScenario[], open: boolean, state: IndexNavState): string {
  const groupId = `nav-group-${r.id}`
  const outcome = outcomeSummary(r.counts)
  const tooltip = state.collapsed ? ` title="${escapeAttr(`${r.title}: ${outcome || 'no scenarios'}`)}"` : ''
  const items = open ? shown.map((sc) => itemHtml(r, sc, state)).join('') : ''
  const head = r.data
    ? `<button type="button" class="nav-group-head" data-group="${escapeAttr(r.id)}" data-nav-key="${escapeAttr(JSON.stringify([r.id]))}" aria-expanded="${open}" aria-controls="${escapeAttr(groupId)}"${tooltip}>`
    : `<a class="nav-group-head" href="${escapeAttr(r.href)}"${tooltip}>`
  return `
      <li class="nav-group${r.id === state.reportId ? ' current' : ''}" data-status="${escapeAttr(r.status)}">
        ${head}
          ${statusDotHtml(r.status)}
          <span class="nav-text">
            <span class="nav-group-title">${escapeHtml(r.title)}</span>
            <span class="nav-meta">${escapeHtml(outcome || 'No scenarios')}</span>
          </span>
          ${r.data ? `<span class="nav-group-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>` : ''}
        ${r.data ? '</button>' : '</a>'}
        <ul class="nav-group-items" id="${escapeAttr(groupId)}" role="list"${open ? '' : ' hidden'}>${items}</ul>
      </li>`
}

function itemHtml(r: IndexReport, sc: IndexScenario, state: IndexNavState): string {
  const current = r.id === state.reportId && state.selectedId === sc.id
  const tip = state.collapsed
    ? ` title="${escapeAttr(navItemTooltip(sc.title, statusLabel(sc.status), sc.messages))}"`
    : ''
  return `
            <li>
              <button type="button" data-nav="${escapeAttr(sc.id)}" data-report="${escapeAttr(r.id)}" data-nav-key="${escapeAttr(JSON.stringify([r.id, sc.id]))}"${current ? ' aria-current="true"' : ''} aria-controls="main"${tip}>
                ${statusDotHtml(sc.status)}
                <span class="nav-icon" aria-hidden="true">${r.scenarios.indexOf(sc) + 1}</span>
                <span class="nav-text">
                  <div class="nav-title">${escapeHtml(sc.title)}</div>
                  <div class="nav-meta">${escapeHtml(statusLabel(sc.status))} · ${sc.messages} messages</div>
                </span>
              </button>
            </li>`
}

/** The scenario list says so when the filters leave nothing, rather than going blank. */
export function orEmptyNavHtml(html: string): string {
  return html.trim() ? html : '<li class="nav-empty">No scenarios match.</li>'
}
