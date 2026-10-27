// Generated from modules/lsd-mono-report-schema/lsd-index.schema.json by scripts/report-types.mjs.
// Do not edit: change the schema, then run `npm run types:generate`.

/**
 * A scenario's or report's outcome, in lower case.
 */
export type Status = 'success' | 'warn' | 'error'

/**
 * The index page's manifest of every report in an output directory: window.__LSD_INDEX__ in index.html. Each report's data loads from its <stem>-report.js when opened. Pre-1.0: may change before 1.0.0. Objects accept properties they do not list.
 */
export interface IndexManifest {
  /**
   * The version of the schema the manifest follows; the same as the reports'. 0.3.0 for this schema.
   */
  schemaVersion: string
  /**
   * Always `LSD reports` from lsd-mono-jvm.
   */
  title: string
  /**
   * When the index was written: an RFC 3339 date-time, with Z or a UTC offset.
   */
  generatedAt: string
  /**
   * As for a report; the usage ping matches it.
   */
  generator: string
  options: IndexOptions
  /**
   * Failed reports first, then warnings, then the rest; by title within each.
   */
  reports: IndexReport[]
}
export interface IndexOptions {
  /**
   * As for a report.
   */
  usagePing: boolean
}
/**
 * This interface was referenced by `IndexManifest`'s JSON-Schema
 * via the `definition` "IndexReport".
 */
export interface IndexReport {
  /**
   * The report's file-name stem, unique in the directory; its page's file name for an entry that is only a link.
   */
  id: string
  title: string
  status: Status
  /**
   * The report's own page (<stem>-diagram.html). Used when there is no data script.
   */
  href: string
  /**
   * <stem>-report.js. Absent for an entry that is only a link.
   */
  data?: string
  counts: IndexCounts
  /**
   * In report order, so the index lists them before the data loads.
   */
  scenarios: IndexScenario[]
}
/**
 * A report's scenarios by outcome.
 *
 * This interface was referenced by `IndexManifest`'s JSON-Schema
 * via the `definition` "IndexCounts".
 */
export interface IndexCounts {
  success: number
  warn: number
  error: number
}
/**
 * This interface was referenced by `IndexManifest`'s JSON-Schema
 * via the `definition` "IndexScenario".
 */
export interface IndexScenario {
  id: string
  title: string
  status: Status
  /**
   * How many message events the scenario has.
   */
  messages: number
}
