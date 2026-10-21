// The report's shapes. They are generated from the JSON Schema in modules/lsd-mono-report-schema
// into src/generated/lsd-report.ts (`npm run types:generate`); this module keeps the import path
// the UI uses.
//
// The generated Report, Scenario and ReportOptions are the report as a producer writes it, where
// the options and a scenario's timing summary are optional. Report, Scenario and ReportOptions
// here are the report as the UI holds it, after normaliseReport (lib/report-normalise.ts) has
// filled those in: the rest of the UI never applies a default of its own.
import type {
  Report as ReportJson,
  ReportOptions as ReportOptionsJson,
  Scenario as ScenarioJson,
} from './generated/lsd-report'

export type * from './generated/lsd-report'
export { REPORT_SCHEMA_VERSION } from './generated/lsd-report'
export type { ReportJson, ReportOptionsJson, ScenarioJson }

/** A report's options with their defaults filled in. `source` stays optional: absent is no known source. */
export type ReportOptions = Required<Omit<ReportOptionsJson, 'source'>> & Pick<ReportOptionsJson, 'source'>

/** A scenario with its timing summary filled in, and without events of a kind the UI does not know. */
export type Scenario = ScenarioJson &
  Required<Pick<ScenarioJson, 'accuracy' | 'sources' | 'clockOrdering' | 'clockOrdered'>>

/** A report as the UI holds it: see normaliseReport. */
export interface Report extends Omit<ReportJson, 'options' | 'scenarios'> {
  options: ReportOptions
  scenarios: Scenario[]
}
