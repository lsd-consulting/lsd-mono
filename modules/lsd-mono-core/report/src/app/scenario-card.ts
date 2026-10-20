// The scenario card: its header, description, facts, timing strip and sequence diagram, and the report hero above it.
import type { Scenario } from '../types'
import { scenarioDescriptionHtml } from '../ui/scenario-summary'
import { timingStripHtml } from '../ui/timing'
import { renderDiagramHtml } from '../lib/sequence-diagram'
import { DEFAULT_LABEL_MAX_WIDTH, formatGeneratedAt } from '../ui/format'
import { escapeAttr, escapeHtml } from '../lib/escape'
import { index, session } from './context'
export function heroHtml(): string {
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

export function scenarioHtml(s: Scenario): string {
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
        <div class="diagram-heading">
          <h3>Sequence diagram</h3>
          <span class="diagram-hint">Zoom and overview · hide participants · find labels · ↑↓ between messages</span>
        </div>
        ${diagram}
      </section>
    </div>
  </article>`
}
