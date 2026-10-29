// Generated from modules/lsd-mono-report-schema/lsd-report.schema.json by scripts/report-types.mjs.
// Do not edit: change the schema, then run `npm run types:generate`.

/** The schema version this UI's types follow, as reports write it in `schemaVersion`. */
export const REPORT_SCHEMA_VERSION = '1.0.0'

/**
 * A scenario's outcome. success: it passed. warn: it passed with something to look at, or did not finish (pending, undefined, ambiguous). error: it failed. skipped: it did not run (disabled, or skipped by the runner). aborted: it started and was stopped before it finished, such as by a failed assumption. Closed: a reader can rank and count every value. A report's status is the worst of its scenarios', ranked error, warn, success, aborted, skipped; success when there are none.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Status".
 */
export type Status = 'success' | 'warn' | 'error' | 'skipped' | 'aborted'
/**
 * The integration that wrote the report, counted by the usage ping. Open: a newer producer may send a value not listed here. Readers treat a value they do not know as no known source (the usage ping counts no source).
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ReportSource".
 */
export type ReportSource = KnownReportSource | (string & {})
/**
 * How a participant is drawn. Open: a newer producer may send a value not listed here. Readers draw a type they do not know as participant.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ParticipantType".
 */
export type ParticipantType = KnownParticipantType | (string & {})
/**
 * One attribute's value, as OpenTelemetry's are: a string, a boolean, a number, or a list of one of those.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "AttributeValue".
 */
export type AttributeValue = string | boolean | number | string[] | boolean[] | number[]
/**
 * One row of a sequence diagram, by kind. The generated TypeScript type leaves out UnknownEvent: the report UI drops those when it loads a report.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "DiagramEvent".
 */
export type DiagramEvent =
  MessageEvent | NoteEvent | DividerEvent | SectionEvent | DelayEvent | SpacerEvent | ActivateEvent
/**
 * Optional on a scenario; see Scenario for the default. Closed: each value is a rung on one ladder the page ranks, so a value it does not know could not be ranked.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Accuracy".
 */
export type Accuracy = 'structure_only' | 'timestamped' | 'measured' | 'traced'
/**
 * Optional on a scenario; default same_source. Closed: the setting the producer ordered by; a new mode would change what the diagram's order means, which is a major change.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "ClockOrdering".
 */
export type ClockOrdering = 'off' | 'same_source' | 'all_sources'
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
export type KnownParticipantType = 'actor' | 'participant' | 'database' | 'queue' | 'entity' | 'boundary'
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownMessageType".
 */
export type KnownMessageType =
  | 'synchronous'
  | 'synchronous_response'
  | 'asynchronous'
  | 'lost'
  | 'bi_directional'
  | 'short_inbound'
  | 'short_outbound'
/**
 * How a message's arrow is drawn. short_inbound comes in from the diagram's edge and short_outbound leaves to it. Open: a newer producer may send a value not listed here. Readers draw a type they do not know as a synchronous arrow.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "MessageType".
 */
export type MessageType = KnownMessageType | (string & {})
/**
 * Closed: the three places a sequence diagram can draw a note.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "NotePlacement".
 */
export type NotePlacement = 'over' | 'left' | 'right'
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownTimingSource".
 */
export type KnownTimingSource = 'none' | 'timestamped' | 'measured' | 'derived'
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
export type KnownPairingSource = 'none' | 'guessed' | 'call_id' | 'trace'
/**
 * How a reply was paired with its call. Open: a newer producer may send a value not listed here. Readers treat a value they do not know as none.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "PairingSource".
 */
export type PairingSource = KnownPairingSource | (string & {})
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownOrderSource".
 */
export type KnownOrderSource = 'sequence' | 'structure' | 'clock'
/**
 * What put a message where it is. clock: moved by clock ordering (startedAt), shown with a badge. Open: a newer producer may send a value not listed here. Readers treat a value they do not know as sequence.
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
  'reply_without_call' | 'duration_on_reply_dropped' | 'longer_than_parent' | 'duplicate_span' | 'skew'
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownReportSource".
 */
export type KnownReportSource = 'junit' | 'cucumber' | 'api'
/**
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "KnownMessageOrigin".
 */
export type KnownMessageOrigin = 'captured' | 'imported'
/**
 * Where a message came from: captured, recorded by the producer while the test ran (as lsd-mono-jvm does), or imported, built afterwards from another record, such as OpenTelemetry spans from a file or a trace backend. Absent means captured. Not the same as source, the message's clock domain. Open: a newer producer may send a value not listed here. Readers show a value they do not know as it is.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "MessageOrigin".
 */
export type MessageOrigin = KnownMessageOrigin | (string & {})

/**
 * One LSD report: its scenarios, each with a sequence diagram's participants and events. Written by lsd-mono-jvm as <stem>-report.json, and as window.__LSD_REPORT__ in the diagram page. Stable from 1.0.0. The compatibility rule: readers ignore fields they do not know, and a minor version only adds optional fields, values of open enums and event kinds. Objects accept properties they do not list, and the open enums (see each one) accept values they do not list, so this schema still validates a report of a newer minor version. status is the worst scenario status, ranked error, warn, success, aborted, skipped; success when there are no scenarios. Enum values are lower snake_case. Optional fields are never written empty: a list, object or string that would be empty is left out, and a reader reads a missing one as empty. Required fields are always written.
 */
export interface Report {
  /**
   * The version of this schema the report follows: semver, apart from the lsd-mono version. 1.0.0 for this schema.
   */
  schemaVersion: string
  title: string
  /**
   * When the report was written: an RFC 3339 date-time, with Z or a UTC offset. lsd-mono-jvm writes UTC with Z, to the millisecond or less (the seconds alone when they are whole).
   */
  generatedAt: string
  generator: Generator
  status: Status
  options?: ReportOptions
  /**
   * Absent when the report has none.
   *
   * @minItems 1
   */
  scenarios?: [Scenario, ...Scenario[]]
}
/**
 * What wrote the document. The page shows "Written by <name>", with the version only when it differs from the viewer's.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Generator".
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
  labelMaxChars?: number
  /**
   * Whether the page may request the usage ping files: at most one fire-and-forget request per event, whose failure is ignored. The ping names the viewer's version, not the generator. lsd-mono-jvm writes true unless lsd.mono.report.usagePing=false. A missing value is read as false, so a report that does not say is never pinged.
   */
  usagePing?: boolean
  source?: ReportSource
}
/**
 * One scenario: a test or a feature's scenario. The timing summary (accuracy to pairAccuracy) sits flat on the scenario, not in an object of its own. accuracy says how the scenario's timings were captured. The timing summary (accuracy, sources, clockOrdering, clockOrdered and the optional fields after them) is optional for a producer without timing analysis. A reader's defaults: accuracy measured when a message has a duration or start time, else structure_only; sources as described; clockOrdering same_source; clockOrdered 0.
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
   * Plain text; Given, When, Then and And lines are highlighted. Absent when there is none.
   */
  description?: string
  error?: ScenarioError
  /**
   * Absent when there are none.
   *
   * @minItems 1
   */
  facts?: [Fact, ...Fact[]]
  /**
   * Absent when there are none.
   *
   * @minItems 1
   */
  metrics?: [Metric, ...Metric[]]
  /**
   * Absent when there are none.
   *
   * @minItems 1
   */
  participants?: [Participant, ...Participant[]]
  /**
   * Absent when there are none.
   *
   * @minItems 1
   */
  events?: [DiagramEvent, ...DiagramEvent[]]
  accuracy?: Accuracy
  /**
   * Share of calls with a measured duration, 0 to 1. Absent when there are no calls.
   */
  measuredRatio?: number
  /**
   * Share of calls paired with their reply by call id or trace, 0 to 1. Absent when there are no calls.
   */
  pairedRatio?: number
  /**
   * Distinct clock domains of the messages, local included (local is the name for a message with no source). Absent when unknown or empty: a reader's default is ["local"] when the scenario has messages, else [].
   *
   * @minItems 1
   */
  sources?: [string, ...string[]]
  /**
   * From the first start to the last end. Only for a single clock domain whose measured calls all have a start. Milliseconds, to the microsecond, without trailing zeros.
   */
  wallClockMs?: number
  clockOrdering?: ClockOrdering
  /**
   * How many messages clock ordering placed. Default 0.
   */
  clockOrderedCount?: number
  /**
   * Absent when there are none.
   *
   * @minItems 1
   */
  warnings?: [TimingWarning, ...TimingWarning[]]
  /**
   * Ids of the messages clock ordering moved. Absent when there are none.
   *
   * @minItems 1
   */
  reorderedByClock?: [string, ...string[]]
  /**
   * Accuracy per participant pair, present only when the pairs differ.
   *
   * @minItems 1
   */
  pairAccuracy?: [PairAccuracy, ...PairAccuracy[]]
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
   * The name drawn for the participant instead of name. Absent when it has none.
   */
  displayName?: string
  /**
   * A CSS color for the participant's header.
   */
  color?: string
  attributes?: Attributes
}
/**
 * Facts about the participant, such as the service it is (service.name, service.version, service.namespace) or the remote service it stands for (peer.service).
 */
export interface Attributes {
  [k: string]: AttributeValue | undefined
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
   * Sender id; absent for the diagram's edge, as on a message.
   */
  from?: string
  /**
   * Receiver id; absent for the diagram's edge, as on a message.
   */
  to?: string
  accuracy: Accuracy
}
/**
 * Trace context on a message, in OpenTelemetry's terms, and frozen at these three ids: no minor version adds to it, and anything more about the span (trace flags, trace state, span kind, status) goes in the message's attributes. Ids are as the producer received them; lsd-mono-jvm never invents them. W3C Trace Context and OpenTelemetry write lowercase hex, 32 characters for traceId and 16 for spanId and parentSpanId, and a producer should write them that way. B3 ids are accepted too, including a 16-character (64-bit) traceId, so no format is enforced.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Trace".
 */
export interface Trace {
  /**
   * The trace: 32 lowercase hex characters (W3C, OpenTelemetry), or 16 or 32 for B3.
   */
  traceId: string
  /**
   * This message's span: 16 lowercase hex characters. A reply with its call's spanId is paired with it.
   */
  spanId?: string
  /**
   * The span this one runs inside: 16 lowercase hex characters. Nests the message inside the call with that spanId.
   */
  parentSpanId?: string
}
/**
 * Facts about a message or a participant as named keys, such as a message's HTTP route or messaging destination, or the service a participant is. Keys use OpenTelemetry semantic convention names where there is one (http.request.method, http.route, http.response.status_code, url.full, messaging.destination.name, rpc.method; service.name, service.version, peer.service), and keys starting lsd. are kept for lsd-mono's own. Keys are not empty. Absent, rather than empty, when there are none. Readers show or ignore them; no attribute changes how a message or participant is drawn.
 *
 * This interface was referenced by `Report`'s JSON-Schema
 * via the `definition` "Attributes".
 */
export interface Attributes1 {
  [k: string]: AttributeValue | undefined
}
/**
 * A message between two participants. data is its payload: any JSON value, absent when it has none. In the diagram page's copy, when payloadId is set, only the payload's method, path and status (or nothing) stay in data. Ids: id identifies the event. callId pairs a call with its reply; replyTo points a reply at its call's id; causedBy points a consume at its publish's callId; parentId points at the enclosing call's id.
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
   * Sender id. Absent for a message from the diagram's edge: short_inbound.
   */
  from?: string
  /**
   * Receiver id. Absent for a message to the diagram's edge: short_outbound.
   */
  to?: string
  label: string
  type: MessageType
  /**
   * A CSS color for the arrow and label.
   */
  color?: string
  /**
   * Milliseconds, to the microsecond, without trailing zeros.
   */
  durationMs?: number
  data?: unknown
  /**
   * Capture order. Absent when not counted.
   */
  seq?: number
  /**
   * The correlation key a call and its reply share, such as a span or request id. On a reply the producer copies its call's callId (lsd-mono-jvm: the id it was given, else the call's message id).
   */
  callId?: string
  /**
   * On a reply paired with its call: the message id of the call it answers. Absent on an unpaired reply.
   */
  replyTo?: string
  /**
   * On a consume: the callId of the publish that caused it.
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
   * The message's status, such as an HTTP status, as text even when it is a number. Absent when it has none.
   */
  status?: string
  timing?: TimingSource
  pairing?: PairingSource
  order?: OrderSource
  /**
   * The message id of the call this message runs inside, as the producer nested it (span link, else innermost open call).
   */
  parentId?: string
  attributes?: Attributes1
  origin?: MessageOrigin
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
   * Activation bar color. Only on activate, and only when the caller set one.
   */
  color?: string
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
