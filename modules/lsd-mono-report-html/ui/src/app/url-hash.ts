// The URL hash: write the shown scenario or open message without triggering hashchange.
import { writeReportHash, type HashRef } from '../lib/report-hash'
import { index, session, state } from './context'

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

export function writeHash(ref: HashRef | null): void {
  session.writingHash = true
  const named = index && session.reportId ? { ...(ref ?? { scenarioId: '' }), reportId: session.reportId } : ref
  writeReportHash(reportLocation(), named)
  session.writingHash = false
}

/** The URL names the shown scenario and view; an open message replaces it with #msg= (see openMessage). */
export function writeScenarioHash(): void {
  const view = session.diagramView === 'components' && shownHasComponents() ? { view: 'components' as const } : {}
  writeHash(state.selectedId ? { scenarioId: state.selectedId, ...view } : null)
}

/**
 * A link that names the Components view of a scenario without one falls back to Sequence: take
 * &view=components out of the URL too, so it says what is shown. An open message's hash is left.
 */
export function dropUnshownView(): void {
  if (session.panelScenarioId || !window.location.hash.includes('&view=components') || shownHasComponents()) return
  writeScenarioHash()
}

/** The card shown has a Components view: one without component links shows Sequence. */
function shownHasComponents(): boolean {
  return Boolean(document.querySelector('#main .diagram-pane[data-pane="components"]'))
}
