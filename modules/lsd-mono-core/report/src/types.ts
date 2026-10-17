/** Domain-shaped report model (mirrors lsd-core ScenarioModel / SequenceEvent ideas). */

export type Status = 'success' | 'warn' | 'error'

export type ParticipantType = 'ACTOR' | 'PARTICIPANT' | 'DATABASE' | 'QUEUE' | 'ENTITY' | 'BOUNDARY'

export type MessageType =
  | 'SYNCHRONOUS'
  | 'SYNCHRONOUS_RESPONSE'
  | 'ASYNCHRONOUS'
  | 'LOST'
  | 'BI_DIRECTIONAL'
  | 'SHORT_INBOUND'
  | 'SHORT_OUTBOUND'

export type NotePlacement = 'over' | 'left' | 'right'

export interface Participant {
  id: string
  name: string
  alias?: string
  type: ParticipantType
  colour?: string
}

export interface NoteEvent {
  kind: 'note'
  id: string
  /** ISO-8601 instant. Sorted before layout when any event in the list has one. */
  startedAt?: string
  text: string
  /** Anchor participant. Required for placement `over`; optional for left/right. */
  over?: string
  placement?: NotePlacement
}

export interface DividerEvent {
  kind: 'divider'
  id: string
  startedAt?: string
  label: string
}

/** Titled row in one continuous diagram. Does not split the SVG or end activations. */
export interface SectionEvent {
  kind: 'section'
  id: string
  startedAt?: string
  title: string
}

/** Time-delay ellipsis (`...label...`). */
export interface DelayEvent {
  kind: 'delay'
  id: string
  startedAt?: string
  label?: string
}

/** Vertical spacer. Optional height in CSS pixels. */
export interface SpacerEvent {
  kind: 'spacer'
  id: string
  startedAt?: string
  heightPx?: number
}

export interface ActivateEvent {
  kind: 'activate' | 'deactivate'
  id: string
  participantId: string
  startedAt?: string
  /** Optional activation-bar colour. Only meaningful for kind `activate`. */
  colour?: string
}

export interface MessageEvent {
  kind: 'message'
  id: string
  /** Empty for SHORT_INBOUND (phantom edge). */
  from: string
  /** Empty for SHORT_OUTBOUND (phantom edge). */
  to: string
  label: string
  type: MessageType
  colour?: string
  durationMs?: number
  /**
   * First-paint summary. Method, path, and status stay here.
   * When `payloadId` is set, this is only those fields (or absent) and the JSON body loads on open.
   */
  data?: unknown
  /** Key into the payload sidecar (`scenarioId/messageId`). Absent when `data` is the whole payload. */
  payloadId?: string
  /** Capture order. */
  seq?: number
  callId?: string
  /** On a reply: the call it answers. */
  replyTo?: string
  /** On a consume: the publish that caused it. */
  causedBy?: string
  trace?: { traceId: string; spanId?: string; parentSpanId?: string }
  /** Clock domain. Absent means `local`. */
  source?: string
  /** When it started, by its source's clock. */
  startedAt?: string
  capturedAt?: string
  status?: string
  timing?: TimingSource
  pairing?: PairingSource
  order?: OrderSource
  /** Id of the call this message runs inside, as the library nested it (span link, else innermost open call). */
  parentId?: string
  /** On a paired reply: id of the call it answers. */
  replyOf?: string
}

export type TimingSource = 'NONE' | 'TIMESTAMPED' | 'MEASURED' | 'DERIVED'
export type PairingSource = 'NONE' | 'GUESSED' | 'CALL_ID' | 'TRACE'
/** `CLOCK`: moved by clock ordering (startedAt). Shown with a badge. */
export type OrderSource = 'SEQUENCE' | 'STRUCTURE' | 'CLOCK'
/** What a timing warning is about; the Timing view labels its pill from it. */
export type WarningKind =
  'REPLY_WITHOUT_CALL' | 'DURATION_ON_REPLY_DROPPED' | 'LONGER_THAN_PARENT' | 'DUPLICATE_SPAN' | 'SKEW'

export interface TimingWarning {
  kind: WarningKind
  message: string
}

export type Accuracy = 'STRUCTURE_ONLY' | 'TIMESTAMPED' | 'MEASURED' | 'TRACED'
export type ClockOrdering = 'OFF' | 'SAME_SOURCE' | 'ALL_SOURCES'

export type DiagramEvent =
  MessageEvent | NoteEvent | DividerEvent | SectionEvent | DelayEvent | SpacerEvent | ActivateEvent

export interface Fact {
  key: string
  value: string
}

export interface Metric {
  key: string
  value: string
}

export interface ReportOptions {
  /** Default true. When false, metrics are empty. */
  metricsEnabled: boolean
  /** Character budget for diagram labels and metric summaries. Default 200. */
  labelMaxWidth: number
}

export interface ScenarioError {
  headline: string
  message: string
  /** Omitted when the producer hid the stacktrace. Shown in the inspector, not inline HTML. */
  stack?: string
}

export interface Scenario {
  id: string
  title: string
  status: Status
  description: string
  /** Structured failure. Prefer this over legacy overlay HTML in description. */
  error?: ScenarioError
  facts: Fact[]
  metrics: Metric[]
  participants: Participant[]
  events: DiagramEvent[]
  /** Timing summary. Absent on older reports, which are treated as structure only. */
  accuracy?: Accuracy
  measuredCoverage?: number
  pairingCoverage?: number
  sources?: string[]
  wallClockMs?: number
  clockOrdering?: ClockOrdering
  clockOrdered?: number
  warnings?: TimingWarning[]
  reorderedByClock?: string[]
  /** Accuracy per participant pair, present only when the pairs differ. */
  pairAccuracy?: { from: string; to: string; accuracy: Accuracy }[]
}

export interface Report {
  title: string
  generatedAt: string
  generator: string
  /** Worst scenario status (error > warn > success). Present on mono-core reports. */
  status?: Status
  /** Metrics gate and label truncation width. Absent on older sample reports. */
  options?: ReportOptions
  scenarios: Scenario[]
}
