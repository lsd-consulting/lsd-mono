import type { PanelPrintView } from './inspector'
import { escapeAttr, escapeHtml } from '../lib/escape'

/**
 * Print-only copies of the side panel's message, error and component link
 * views. The panel itself never prints: it is a narrow, scrolled column beside
 * the report. Its copy goes in the scenario the panel belongs to, straight after
 * that scenario's sequence diagram, so the JSON sits under the arrow it came from.
 * Metrics have their own copy before the diagram (see metrics.ts).
 */

/** Message or error view: title, pills, any lead text, and the JSON or stack in full. */
export function printMessageSection(view: PanelPrintView): string {
  const heading = view.view === 'error' ? 'Error' : view.view === 'link' ? 'Link' : 'Message'
  const lead = view.lead ? `<p class="print-lead">${escapeHtml(view.lead)}</p>` : ''
  const body = view.text != null ? `<pre>${escapeHtml(view.text)}</pre>` : ''
  return `<section class="card print-panel print-message" data-print-panel="${escapeAttr(view.view)}">
    <h3>${heading} · <span class="print-label">${escapeHtml(view.title)}</span></h3>
    ${view.metaHtml ? `<div class="meta-row">${view.metaHtml}</div>` : ''}
    ${lead}${body}
  </section>`
}

/**
 * Keep at most one panel copy, in its scenario after the sequence diagram.
 * Null removes it. A scenario that is filtered out of the page gets none.
 */
export function placePrintPanel(doc: Document, open: { scenarioId: string; html: string } | null): void {
  doc.querySelectorAll('.print-panel').forEach((el) => el.remove())
  if (!open) return
  const diagram = doc.getElementById(`card-${open.scenarioId}`)?.querySelector('.scenario-body > .diagram-panel')
  diagram?.insertAdjacentHTML('afterend', open.html)
}
