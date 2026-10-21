import type { IndexManifest, IndexReport, IndexScenario } from '../generated/lsd-index'
import type { Report, ReportJson, Status } from '../types'
import { normaliseReport } from './report-normalise'
import { cssEscape } from './escape.ts'

/**
 * The index page: every report in an output directory, in one page. lsd-mono-core writes
 * `index.html` as the report shell with this manifest in `window.__LSD_INDEX__`. A report's
 * data is a sibling script (`<stem>-report.js`) that is added only when the report is opened,
 * so the first paint does not grow with the size of the suite.
 */

// The manifest's shapes are generated from modules/lsd-mono-report-schema/lsd-index.schema.json.
export type { IndexCounts, IndexManifest, IndexOptions, IndexReport, IndexScenario } from '../generated/lsd-index'

/** What `<stem>-report.js` adds to `window.__LSD_REPORTS__` under the report's id. */
export interface ReportDataJson {
  report: ReportJson
  /** `<stem>-payloads.js`, or null when every payload is already on its message. */
  payloadsSrc: string | null
}

/** A loaded report's data, its report normalised (lib/report-normalise.ts). */
export interface ReportData {
  report: Report
  payloadsSrc: string | null
}

// One loaded value per registered one, so opening a report again gives the same objects.
const loadedByData = new WeakMap<ReportDataJson, ReportData>()

function loadedData(data: ReportDataJson): ReportData {
  let result = loadedByData.get(data)
  if (!result) {
    result = { ...data, report: normaliseReport(data.report) }
    loadedByData.set(data, result)
  }
  return result
}

const STATUSES: Status[] = ['success', 'warn', 'error']

/** Scenarios by outcome across every report. */
export function indexTotals(manifest: IndexManifest): Record<Status, number> {
  const totals: Record<Status, number> = { success: 0, warn: 0, error: 0 }
  for (const report of manifest.reports) for (const s of STATUSES) totals[s] += report.counts[s] ?? 0
  return totals
}

export interface IndexFilter {
  query: string
  status: Record<Status, boolean>
}

/**
 * The scenarios of a report that the sidebar lists under the filter. A query matches a
 * scenario's title or its report's title. `loaded` replaces the manifest's list for the open
 * report, so its scenarios also match on facts and descriptions.
 */
export function visibleScenarios(
  report: IndexReport,
  filter: IndexFilter,
  matchesLoaded?: (scenarioId: string, query: string) => boolean,
): IndexScenario[] {
  const q = filter.query.trim().toLowerCase()
  const reportMatches = !q || report.title.toLowerCase().includes(q)
  return report.scenarios.filter((s) => {
    if (!filter.status[s.status]) return false
    if (reportMatches) return true
    if (s.title.toLowerCase().includes(q)) return true
    return matchesLoaded ? matchesLoaded(s.id, q) : false
  })
}

/** The report to open when the URL names none: the first in the list (failures come first). */
export function defaultReportId(manifest: IndexManifest): string | null {
  return manifest.reports.find((r) => r.data)?.id ?? null
}

const loaded = new Map<string, Promise<ReportData>>()

/** Test hook. */
export function resetReportDataCache(): void {
  loaded.clear()
}

/**
 * Add the report's data script once and resolve with what it registered. Works from
 * file://, where fetch does not. A failed load is forgotten so it can be retried.
 */
export function loadReportData(report: IndexReport): Promise<ReportData> {
  const src = report.data
  if (!src) return Promise.reject(new Error(`${report.title} has no data script`))
  const ready = window.__LSD_REPORTS__?.[report.id]
  if (ready) return Promise.resolve(loadedData(ready))
  let pending = loaded.get(report.id)
  if (!pending) {
    pending = addScript(src, 'data-lsd-report').then(() => {
      const data = window.__LSD_REPORTS__?.[report.id]
      if (!data) throw new Error(`${src} did not register report ${report.id}`)
      return loadedData(data)
    })
    pending.catch(() => loaded.delete(report.id))
    loaded.set(report.id, pending)
  }
  return pending
}

/** A classic script beside the page, added once. Resolves when it has run. */
export function addScript(src: string, marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[${marker}="${cssEscape(src)}"]`)
    if (existing) existing.remove()
    const script = document.createElement('script')
    script.src = src
    script.setAttribute(marker, src)
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      reject(new Error(`Could not load ${src}`))
    }
    document.head.appendChild(script)
  })
}
