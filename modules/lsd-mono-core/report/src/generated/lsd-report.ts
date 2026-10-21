// Generated from modules/lsd-mono-report-schema/lsd-report.schema.json by scripts/report-types.mjs.
// Do not edit: change the schema, then run `npm run types:generate`.

/** The schema version this UI's types follow, as reports write it in `schemaVersion`. */
export const REPORT_SCHEMA_VERSION = '0.1.0'

/**
 * A scenario's or report's outcome, in lower case.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Status".
 */
export type Status = 'success' | 'warn' | 'error'
/**
 * The integration that wrote the report, counted by the usage ping. Open: a newer producer may send a value not listed here. Readers treat a value they do not know as no known source (the usage ping counts no source).
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportSource".
 */
export type ReportSource = KnownReportSource | (string & {})
/**
 * How a participant is drawn. Open: a newer producer may send a value not listed here. Readers draw a type they do not know as PARTICIPANT.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ParticipantType".
 */
export type ParticipantType = KnownParticipantType | (string & {})
/**
 * One row of a sequence diagram, by kind. The generated TypeScript type leaves out UnknownEvent: the report UI drops those when it loads a report.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "DiagramEvent".
 */
export type DiagramEvent =
  MessageEvent | NoteEvent | DividerEvent | SectionEvent | DelayEvent | SpacerEvent | ActivateEvent
/**
 * Optional on a scenario; see Scenario for the default.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Accuracy".
 */
export type Accuracy = 'STRUCTURE_ONLY' | 'TIMESTAMPED' | 'MEASURED' | 'TRACED'
/**
 * Optional on a scenario; default SAME_SOURCE.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ClockOrdering".
 */
export type ClockOrdering = 'OFF' | 'SAME_SOURCE' | 'ALL_SOURCES'
/**
 * What a timing warning is about; the Timing view labels its pill from it. Open: a newer producer may send a value not listed here. Readers show a kind they do not know with its message only.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "WarningKind".
 */
export type WarningKind = KnownWarningKind | (string & {})
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownParticipantType".
 */
export type KnownParticipantType = 'ACTOR' | 'PARTICIPANT' | 'DATABASE' | 'QUEUE' | 'ENTITY' | 'BOUNDARY'
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownMessageType".
 */
export type KnownMessageType =
  | 'SYNCHRONOUS'
  | 'SYNCHRONOUS_RESPONSE'
  | 'ASYNCHRONOUS'
  | 'LOST'
  | 'BI_DIRECTIONAL'
  | 'SHORT_INBOUND'
  | 'SHORT_OUTBOUND'
/**
 * How a message's arrow is drawn. SHORT_INBOUND comes in from the diagram's edge and SHORT_OUTBOUND leaves to it. Open: a newer producer may send a value not listed here. Readers draw a type they do not know as a SYNCHRONOUS arrow.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "MessageType".
 */
export type MessageType = KnownMessageType | (string & {})
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "NotePlacement".
 */
export type NotePlacement = 'over' | 'left' | 'right'
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownTimingSource".
 */
export type KnownTimingSource = 'NONE' | 'TIMESTAMPED' | 'MEASURED' | 'DERIVED'
/**
 * Where a message's duration came from. Open: a newer producer may send a value not listed here. Readers show a value they do not know as it is.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "TimingSource".
 */
export type TimingSource = KnownTimingSource | (string & {})
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownPairingSource".
 */
export type KnownPairingSource = 'NONE' | 'GUESSED' | 'CALL_ID' | 'TRACE'
/**
 * How a reply was paired with its call. Open: a newer producer may send a value not listed here. Readers treat a value they do not know as NONE.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "PairingSource".
 */
export type PairingSource = KnownPairingSource | (string & {})
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownOrderSource".
 */
export type KnownOrderSource = 'SEQUENCE' | 'STRUCTURE' | 'CLOCK'
/**
 * What put a message where it is. CLOCK: moved by clock ordering (startedAt), shown with a badge. Open: a newer producer may send a value not listed here. Readers treat a value they do not know as SEQUENCE.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "OrderSource".
 */
export type OrderSource = KnownOrderSource | (string & {})
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownWarningKind".
 */
export type KnownWarningKind =
  'REPLY_WITHOUT_CALL' | 'DURATION_ON_REPLY_DROPPED' | 'LONGER_THAN_PARENT' | 'DUPLICATE_SPAN' | 'SKEW'
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownReportSource".
 */
export type KnownReportSource = 'junit' | 'cucumber' | 'api'

/**
 * One LSD report: its scenarios, each with a sequence diagram's participants and events. Written by lsd-mono-core as <stem>-report.json, and as window.__LSD_REPORT__ in the diagram page. Pre-1.0: may change before 1.0.0. Objects accept properties they do not list, and the open enums (see each one) accept values they do not list, so this schema still validates a report of a newer minor version: 0.x minor versions only add. status is the worst scenario status: error, then warn, then success; success when there are no scenarios.
 */
export interface Report {
  /**
   * The version of this schema the report follows: semver, apart from the lsd-mono version. 0.1.0 for this schema.
   */
  schemaVersion: string
  title: string
  /**
   * When the report was written: an RFC 3339 date-time, with Z or a UTC offset. lsd-mono-core writes UTC with Z, to the millisecond or less (the seconds alone when they are whole).
   */
  generatedAt: string
  /**
   * The producer and its version, such as `lsd-mono 0.7.0`. The usage ping matches this text, so it does not change shape.
   */
  generator: string
  status: Status
  options?: ReportOptions
  scenarios: Scenario[]
}
/**
 * Settings the producer wrote the report with. Optional, as is each field: a reader uses the default each field names.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportOptions".
 */
export interface ReportOptions {
  /**
   * When false, every scenario's metrics are empty. Default true.
   */
  metricsEnabled?: boolean
  /**
   * Characters diagram labels and metric summaries are cut to. Default 200.
   */
  labelMaxWidth?: number
  /**
   * Whether the page may request the usage ping files. The page also needs a release generator. Default false.
   */
  usagePing?: boolean
  source?: ReportSource
}
/**
 * One scenario: a test or a feature's scenario. The timing summary (accuracy to pairAccuracy) sits flat on the scenario, not in an object of its own. accuracy says how the scenario's timings were captured. The timing summary (accuracy, sources, clockOrdering, clockOrdered and the optional fields after them) is optional for a producer without timing analysis. A reader's defaults: accuracy MEASURED when a message has a duration or start time, else STRUCTURE_ONLY; sources as described; clockOrdering SAME_SOURCE; clockOrdered 0.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Scenario".
 */
export interface Scenario {
  /**
   * Unique within the report.
   */
  id: string
  title: string
  status: Status
  /**
   * Plain text; Given, When, Then and And lines are highlighted.
   */
  description: string
  error?: ScenarioError
  facts: Fact[]
  metrics: Metric[]
  participants: Participant[]
  events: DiagramEvent[]
  accuracy?: Accuracy
  /**
   * Share of calls with a measured duration, 0 to 1. Absent when there are no calls.
   */
  measuredCoverage?: number
  /**
   * Share of calls paired with their reply by call id or trace, 0 to 1. Absent when there are no calls.
   */
  pairingCoverage?: number
  /**
   * Distinct clock domains of the messages, local included (local is the name for a message with no source). Optional: a reader's default is ["local"] when the scenario has messages, else [].
   */
  sources?: string[]
  /**
   * From the first start to the last end. Only for a single clock domain whose measured calls all have a start. Milliseconds, to the microsecond, without trailing zeros.
   */
  wallClockMs?: number
  clockOrdering?: ClockOrdering
  /**
   * How many messages clock ordering placed. Default 0.
   */
  clockOrdered?: number
  /**
   * Absent, rather than empty, when there are none.
   */
  warnings?: TimingWarning[]
  /**
   * Ids of the messages clock ordering moved. Absent, rather than empty, when there are none.
   */
  reorderedByClock?: string[]
  /**
   * Accuracy per participant pair, present only when the pairs differ.
   */
  pairAccuracy?: PairAccuracy[]
}
/**
 * Why a failed or aborted scenario did not pass.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ScenarioError".
 */
export interface ScenarioError {
  headline: string
  message: string
  /**
   * Absent when the producer hid stack traces. Shown in the inspector as text.
   */
  stack?: string
}
/**
 * A key fact shown on the scenario card.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Fact".
 */
export interface Fact {
  key: string
  value: string
}
/**
 * A metric line. Absent when metrics are off.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Metric".
 */
export interface Metric {
  key: string
  value: string
}
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Participant".
 */
export interface Participant {
  id: string
  name: string
  type: ParticipantType
  /**
   * The participant's display name (displayName in the Kotlin API), drawn instead of name. Absent when it has none.
   */
  alias?: string
  /**
   * A CSS colour for the participant's header.
   */
  colour?: string
}
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "TimingWarning".
 */
export interface TimingWarning {
  kind: WarningKind
  message: string
}
/**
 * The accuracy of the messages between two participants.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "PairAccuracy".
 */
export interface PairAccuracy {
  /**
   * Sender id; an empty string for the diagram's edge, as on a message.
   */
  from: string
  /**
   * Receiver id; an empty string for the diagram's edge, as on a message.
   */
  to: string
  accuracy: Accuracy
}
/**
 * Trace ids on a message.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Trace".
 */
export interface Trace {
  traceId: string
  spanId?: string
  parentSpanId?: string
}
/**
 * A message between two participants. data is its payload: any JSON value, absent when it has none. In the diagram page's copy, when payloadId is set, only the payload's method, path and status (or nothing) stay in data.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "MessageEvent".
 */
export interface MessageEvent {
  kind: 'message'
  /**
   * Unique within the scenario.
   */
  id: string
  /**
   * Sender id. An empty string, not an absent field, for a diagram edge: SHORT_INBOUND.
   */
  from: string
  /**
   * Receiver id. An empty string, not an absent field, for a diagram edge: SHORT_OUTBOUND.
   */
  to: string
  label: string
  type: MessageType
  colour?: string
  /**
   * Milliseconds, to the microsecond, without trailing zeros.
   */
  durationMs?: number
  data?: unknown
  /**
   * Key into the payload sidecar (<scenarioId>/<messageId>), set in the diagram page's copy when the payload loads on open. Never in <stem>-report.json.
   */
  payloadId?: string
  /**
   * Capture order. Absent when not counted.
   */
  seq?: number
  callId?: string
  /**
   * On a reply: the call it answers.
   */
  replyTo?: string
  /**
   * On a consume: the publish that caused it.
   */
  causedBy?: string
  trace?: Trace
  /**
   * Clock domain, such as a service name. Absent means local.
   */
  source?: string
  /**
   * Wall-clock time of capture. Left out of reproducible reports.
   */
  capturedAt?: string
  /**
   * The message's status, such as an HTTP status, as text even when it is a number.
   */
  status?: string
  timing?: TimingSource
  pairing?: PairingSource
  order?: OrderSource
  /**
   * Id of the call this message runs inside, as the library nested it (span link, else innermost open call).
   */
  parentId?: string
  /**
   * On a paired reply: id of the call it answers.
   */
  replyOf?: string
  /**
   * When it started, by its source's clock: an RFC 3339 date-time, with Z or a UTC offset. Events are sorted by it before layout when any event in the list has one.
   */
  startedAt?: string
}
/**
 * A note.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "NoteEvent".
 */
export interface NoteEvent {
  kind: 'note'
  /**
   * Unique within the scenario.
   */
  id: string
  text: string
  /**
   * Anchor participant. Set for placement over; optional for left and right.
   */
  over?: string
  placement: NotePlacement
  /**
   * When it started, by its source's clock: an RFC 3339 date-time, with Z or a UTC offset. Events are sorted by it before layout when any event in the list has one.
   */
  startedAt?: string
}
/**
 * A labelled line across the diagram.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "DividerEvent".
 */
export interface DividerEvent {
  kind: 'divider'
  /**
   * Unique within the scenario.
   */
  id: string
  label: string
  /**
   * When it started, by its source's clock: an RFC 3339 date-time, with Z or a UTC offset. Events are sorted by it before layout when any event in the list has one.
   */
  startedAt?: string
}
/**
 * A titled row in one continuous diagram. Does not split the drawing or end activations.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "SectionEvent".
 */
export interface SectionEvent {
  kind: 'section'
  /**
   * Unique within the scenario.
   */
  id: string
  title: string
  /**
   * When it started, by its source's clock: an RFC 3339 date-time, with Z or a UTC offset. Events are sorted by it before layout when any event in the list has one.
   */
  startedAt?: string
}
/**
 * A time-delay ellipsis (...label...).
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "DelayEvent".
 */
export interface DelayEvent {
  kind: 'delay'
  /**
   * Unique within the scenario.
   */
  id: string
  label?: string
  /**
   * When it started, by its source's clock: an RFC 3339 date-time, with Z or a UTC offset. Events are sorted by it before layout when any event in the list has one.
   */
  startedAt?: string
}
/**
 * Vertical space.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "SpacerEvent".
 */
export interface SpacerEvent {
  kind: 'spacer'
  /**
   * Unique within the scenario.
   */
  id: string
  /**
   * Height in CSS pixels.
   */
  heightPx?: number
  /**
   * When it started, by its source's clock: an RFC 3339 date-time, with Z or a UTC offset. Events are sorted by it before layout when any event in the list has one.
   */
  startedAt?: string
}
/**
 * Starts or ends a participant's activation bar.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ActivateEvent".
 */
export interface ActivateEvent {
  kind: 'activate' | 'deactivate'
  /**
   * Unique within the scenario.
   */
  id: string
  participantId: string
  /**
   * Activation bar colour. Only on activate, and only when the caller set one.
   */
  colour?: string
  /**
   * When it started, by its source's clock: an RFC 3339 date-time, with Z or a UTC offset. Events are sorted by it before layout when any event in the list has one.
   */
  startedAt?: string
}
/**
 * An event of a kind this version does not know, from a newer producer. Event kinds are open: readers drop an event of a kind they do not know.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "UnknownEvent".
 */
export interface UnknownEvent {
  kind: string
  id: string
}
