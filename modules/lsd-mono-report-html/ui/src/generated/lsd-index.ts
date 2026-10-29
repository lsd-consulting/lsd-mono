// Generated from modules/lsd-mono-report-schema/lsd-index.schema.json by scripts/report-types.mjs.
// Do not edit: change the schema, then run `npm run types:generate`.

/**
 * A scenario's outcome. success: it passed. warn: it passed with something to look at, or did not finish (pending, undefined, ambiguous). error: it failed. skipped: it did not run (disabled, or skipped by the runner). aborted: it started and was stopped before it finished, such as by a failed assumption. Closed: a reader can rank and count every value. A report's status is the worst of its scenarios', ranked error, warn, aborted, success, skipped; success when there are none.
 */
export type Status = 'success' | 'warn' | 'error' | 'skipped' | 'aborted'

/**
 * The index page's manifest of every report in an output directory: window.__LSD_INDEX__ in index.html. Each report's data loads from its <stem>-report.js when opened. Stable from 1.0.0: a minor version only adds, and a breaking change takes a new major version. Objects accept properties they do not list. Optional fields follow the report's rule: never written empty, and missing reads as empty.
 */
export interface IndexManifest {
  /**
   * The version of the schema the manifest follows; the same as the reports'. 1.0.0 for this schema.
   */
  schemaVersion: string
  /**
   * A heading for the index. Optional: lsd-mono-jvm does not write it, and the page shows `LSD reports` when it is absent.
   */
  title?: string
  /**
   * When the index was written: an RFC 3339 date-time, with Z or a UTC offset.
   */
  generatedAt: string
  generator: Generator
  options?: IndexOptions
  /**
   * Failed reports first, then warnings, passes, aborted and skipped; by title within each. Absent when there are none.
   *
   * @minItems 1
   */
  reports?: [IndexReport, ...IndexReport[]]
}
/**
 * What wrote the document. The page shows "Written by <name>", with the version only when it differs from the viewer's.
 */
export interface Generator {
  /**
   * The producer, such as lsd-mono-jvm.
   */
  name: string
  /**
   * The producer's version. Absent when it has none, such as a development build.
   */
  version?: string
}
/**
 * Optional. lsd-mono-jvm writes usagePing.
 */
export interface IndexOptions {
  /**
   * As for a report: a missing value, or missing options, is read as false.
   */
  usagePing?: boolean
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
   * In report order, so the index lists them before the data loads. Absent when the report has none.
   *
   * @minItems 1
   */
  scenarios?: [IndexScenario, ...IndexScenario[]]
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
  skipped: number
  aborted: number
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
  messageCount: number
}
