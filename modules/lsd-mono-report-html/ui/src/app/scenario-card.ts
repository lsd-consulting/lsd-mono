// The scenario card: its header, description, facts, timing strip and diagram (Sequence or
// Components, #105), and the report hero above it.
import type { Scenario } from '../types'
import { scenarioDescriptionHtml } from '../ui/scenario-summary'
import { timingStripHtml } from '../ui/timing'
import { panelControlsHtml, renderDiagramHtml } from '../lib/sequence-diagram'
import { componentViewHtml } from '../lib/component-view'
import { componentZoomShown } from '../lib/component-zoom'
import { zoomControlsHtml, zoomHintHtml } from '../lib/diagram/zoom-readout'
import { hasComponentDiagram } from '../lib/component-graph'
import { type DiagramViewName, diagramViewHeading, diagramViewHint } from '../lib/diagram-view-names'
import { formatGeneratedAt } from '../ui/format'
import { newerMinorNoticeHtml } from '../lib/schema-version'
import { escapeAttr, escapeHtml } from '../lib/escape'
import { repoLinkAttrsHtml } from '../ui/repo-link'
import { index, session } from './context'
import { VIEWER_VERSION } from '../lib/viewer-version'

/** The version chip: this page's own version, the same whatever wrote the data. */
export function viewerLabel(version: string = VIEWER_VERSION): string {
  return `lsd-mono ${version}`
}
export function heroHtml(): string {
  const back = index
    ? `<p class="hero-index">${escapeHtml(index.title)} · report ${index.reports.findIndex((r) => r.id === session.reportId) + 1} of ${index.reports.length}</p>`
    : ''
  return `
    <div class="report-hero">
      ${back}
      ${index ? newerMinorNoticeHtml(index.schemaVersion, 'index') : ''}
      ${newerMinorNoticeHtml(session.report.schemaVersion)}
      <h1>${escapeHtml(session.report.title)}</h1>
      <div class="meta">
        <span>Generated ${escapeHtml(formatGeneratedAt(session.report.generatedAt))}</span>
        ${session.report.generator ? `<span class="generator">Written by ${escapeHtml(session.report.generator)}</span>` : ''}
        <a class="version-link repo-link" ${repoLinkAttrsHtml(`${viewerLabel()}: lsd-mono on GitHub`)}><code>${escapeHtml(viewerLabel())}</code></a>
      </div>
    </div>`
}

export function scenarioHtml(s: Scenario): string {
  const labelMaxWidth = session.report.options.labelMaxWidth
  const diagram = renderDiagramHtml(s, labelMaxWidth)
  // The chosen view sticks across scenarios (#105); one without component links shows Sequence.
  const components = hasComponentDiagram(s)
  const shown: DiagramViewName = components ? session.diagramView : 'sequence'
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
      <section class="diagram-panel" data-view="${shown}">
        <div class="diagram-heading">
          <h3 id="diagram-title">${escapeHtml(diagramViewHeading(shown))}</h3>
          ${diagramTabsHtml(shown, components)}
          <span class="diagram-hint">${escapeHtml(diagramViewHint(shown))}</span>
          <span class="diagram-view-status visually-hidden" role="status"></span>
        </div>
        <div class="diagram-area" id="diagram-area" role="tabpanel" aria-labelledby="diagram-tab-${shown}">
          <div class="diagram-pane" data-pane="sequence"${shown === 'sequence' ? '' : ' hidden'}>${diagram}</div>
          ${components ? `<div class="diagram-pane" data-pane="components"${shown === 'components' ? '' : ' hidden'}>${componentsPaneHtml(s)}</div>` : ''}
        </div>
      </section>
    </div>
  </article>`
}

/** The Components view, with its Zoom group and Metrics, at the scenario's zoom. */
function componentsPaneHtml(s: Scenario): string {
  const zoom = componentZoomShown(s.id)
  return componentViewHtml(s, `${zoomControlsHtml(zoom)}${zoomHintHtml(zoom)}${panelControlsHtml(s)}`, zoom.zoom)
}

/**
 * The Sequence | Components tabs (#105): manual activation, so ←/→ move between them and
 * Enter or Space selects; only the selected one is a tab stop. Without component links,
 * Components is disabled and says why.
 */
function diagramTabsHtml(shown: DiagramViewName, components: boolean): string {
  const tab = (name: DiagramViewName, text: string) => {
    const selected = name === shown
    const off = name === 'components' && !components
    // The reason is the tab's description, so a screen reader says it, not only a hover.
    const disabled = off
      ? ' aria-disabled="true" aria-describedby="diagram-tab-components-why" title="No messages between components"'
      : ''
    return `<button type="button" role="tab" class="diagram-tab" id="diagram-tab-${name}" data-diagram-view="${name}" aria-selected="${selected}" aria-controls="diagram-area" tabindex="${selected ? 0 : -1}"${disabled}>${escapeHtml(text)}</button>`
  }
  const why = components
    ? ''
    : '<span id="diagram-tab-components-why" class="visually-hidden">No messages between components</span>'
  return `<div class="diagram-tabs" role="tablist" aria-label="Diagram">${tab('sequence', 'Sequence')}${tab('components', 'Components')}</div>${why}`
}
