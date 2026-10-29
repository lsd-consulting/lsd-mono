// The page's state: the index manifest, the report session, filters and selection, and the #app root.
import { sampleReport } from '../data/sample-report'
import { REPORT_SCHEMA_VERSION, type Report, type Status } from '../types'
import { normaliseIndex, type IndexManifest } from '../lib/report-index'
import { parseReportHash } from '../lib/report-hash'
import { defaultScenarioId } from '../ui/selection'
import { getSidebarCollapsed } from '../ui/sidebar'
import { normaliseReport } from '../lib/report-normalise'
import { unreadableFit } from '../lib/schema-version'
import { createSession } from '../ui/session'

export interface State {
  query: string
  status: Record<Status, boolean>
  /** The scenario shown in the main column (#39). Kept while filters hide it all. */
  selectedId: string | null
  sidebarCollapsed: boolean
  /** Index page: reports whose scenarios are listed in the sidebar. */
  expanded: Set<string>
  /** Narrow screens: the list is open past the selected item. Not remembered across reloads. */
  navOpen: boolean
}

/** The index page's manifest. Null on a single report's page. */
export const index: IndexManifest | null = window.__LSD_REPORT__
  ? null
  : window.__LSD_INDEX__
    ? normaliseIndex(window.__LSD_INDEX__)
    : null

/**
 * The page's report or index when it is of a newer major version, which this page cannot show:
 * main.ts then shows only the upgrade page. Read before anything else, as such data may not
 * have the shape this page expects.
 */
export const unreadable = (() => {
  const fit = unreadableFit(window.__LSD_REPORT__ ?? index)
  return fit && { ...fit, what: window.__LSD_REPORT__ ? ('report' as const) : ('index' as const) }
})()

/** Everything else the page changes as it runs. */
export const session = createSession(
  unreadable
    ? emptyReport()
    : window.__LSD_REPORT__
      ? normaliseReport(window.__LSD_REPORT__)
      : index
        ? indexPlaceholder(index)
        : sampleReport,
)

/** The report behind the upgrade page: nothing to show. */
function emptyReport(): Report {
  return normaliseReport({
    schemaVersion: REPORT_SCHEMA_VERSION,
    title: 'LSD report',
    generatedAt: '',
    generator: { name: 'lsd-mono' },
    status: 'success',
  })
}

/** The index page's report until one is opened: no scenarios, and it never pings. */
function indexPlaceholder(manifest: IndexManifest): Report {
  return normaliseReport({
    schemaVersion: manifest.schemaVersion,
    title: manifest.title,
    generatedAt: manifest.generatedAt,
    generator: manifest.generator,
    status: 'success',
  })
}

// A link or a reload names the view too (#105).
const initialRef = index ? null : parseReportHash(window.location.hash)
if (initialRef?.view === 'components' && !initialRef.messageId) session.diagramView = 'components'

export const state: State = {
  query: '',
  status: { success: true, warn: true, error: true, skipped: true, aborted: true },
  selectedId: initialSelection(),
  sidebarCollapsed: getSidebarCollapsed(),
  expanded: new Set(),
  navOpen: false,
}

export const app = document.querySelector('#app')!

/** The scenario in the URL (a link or a reload), otherwise the first in the list. */
function initialSelection(): string | null {
  if (index) return null
  const ref = parseReportHash(window.location.hash)
  if (ref && session.report.scenarios.some((s) => s.id === ref.scenarioId)) return ref.scenarioId
  return defaultScenarioId(session.report.scenarios)
}
