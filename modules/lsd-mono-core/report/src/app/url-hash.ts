// The URL hash: write the shown scenario or open message without triggering hashchange.
import { writeReportHash, type HashRef } from '../lib/report-hash'
import { index, session, state } from './context'

export function reportLocation(): { hash: string; replace?: (url: string) => void } {
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

/** The URL names the shown scenario; an open message replaces it with #msg= (see openMessage). */
export function writeScenarioHash(): void {
  writeHash(state.selectedId ? { scenarioId: state.selectedId } : null)
}
