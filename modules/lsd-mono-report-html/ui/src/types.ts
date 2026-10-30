// The report's shapes. They are generated from the JSON Schema in modules/lsd-mono-report-schema
// into src/generated/lsd-report.ts (`npm run types:generate`); this module keeps the import path
// the UI uses.
//
// The generated Report, Scenario, ReportOptions and MessageEvent are the report as a producer
// writes it, where the options, a scenario's timing summary, its empty lists and a message's
// missing end are left out. Report, Scenario, ReportOptions and MessageEvent here are the report
// as the UI holds it, after normaliseReport (lib/report-normalise.ts) has filled those in: the
// rest of the UI never applies a default of its own.
import type {
  ActivateEvent,
  DelayEvent,
  DividerEvent,
  Fact,
  MessageEvent as MessageEventJson,
  Metric,
  NoteEvent,
  PairAccuracy,
  Participant,
  Report as ReportJson,
  ReportOptions as ReportOptionsJson,
  Scenario as ScenarioJson,
  SectionEvent,
  SpacerEvent,
  TimingWarning,
} from './generated/lsd-report'

export type * from './generated/lsd-report'
export { REPORT_SCHEMA_VERSION } from './generated/lsd-report'
export type { MessageEventJson, ReportJson, ReportOptionsJson, ScenarioJson }

/** A report's options with their defaults filled in. `source` stays optional: absent is no known source. */
export type ReportOptions = Required<Omit<ReportOptionsJson, 'source'>> & Pick<ReportOptionsJson, 'source'>

/**
 * A message with both ends: an end the producer left out (a found or lost message) is `''`.
 * `payloadId` is the page's own: the report shell sets it on a message whose payload is in the
 * payload script, and it is never in a report file.
 */
export interface MessageEvent extends Omit<MessageEventJson, 'from' | 'to'> {
  from: string
  to: string
  payloadId?: string
}

/** One row of a sequence diagram, by kind, as the UI holds it. */
export type DiagramEvent =
  MessageEvent | NoteEvent | DividerEvent | SectionEvent | DelayEvent | SpacerEvent | ActivateEvent

type Lists =
  'facts' | 'metrics' | 'participants' | 'events' | 'sources' | 'warnings' | 'reorderedByClock' | 'pairAccuracy'

/**
 * A scenario with its description, lists and timing summary filled in (an absent list is empty),
 * and without events of a kind the UI does not know.
 */
export interface Scenario extends Omit<
  ScenarioJson,
  Lists | 'description' | 'accuracy' | 'clockOrdering' | 'clockOrderedCount'
> {
  description: string
  facts: Fact[]
  metrics: Metric[]
  participants: Participant[]
  events: DiagramEvent[]
  sources: string[]
  warnings?: TimingWarning[]
  reorderedByClock?: string[]
  pairAccuracy?: PairAccuracy[]
  accuracy: NonNullable<ScenarioJson['accuracy']>
  clockOrdering: NonNullable<ScenarioJson['clockOrdering']>
  clockOrderedCount: number
}

/** A report as the UI holds it: see normaliseReport. */
export interface Report extends Omit<ReportJson, 'options' | 'scenarios'> {
  options: ReportOptions
  scenarios: Scenario[]
}
