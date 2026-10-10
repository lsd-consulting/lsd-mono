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

export type NoteSide = 'over' | 'left' | 'right'

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
  createdAt?: string
  text: string
  /** Anchor participant. Required for placement `over`; optional for left/right. */
  over?: string
  placement?: NoteSide
}

export interface DividerEvent {
  kind: 'divider'
  id: string
  createdAt?: string
  label: string
}

/** Titled row in one continuous diagram. Does not split the SVG or end activations. */
export interface SectionEvent {
  kind: 'section'
  id: string
  createdAt?: string
  title: string
}

/** Time-delay ellipsis (`...label...`). */
export interface DelayEvent {
  kind: 'delay'
  id: string
  createdAt?: string
  label?: string
}

/** Vertical spacer. Optional height in CSS pixels. */
export interface SpacerEvent {
  kind: 'spacer'
  id: string
  createdAt?: string
  heightPx?: number
}

export interface ActivateEvent {
  kind: 'activate' | 'deactivate'
  id: string
  participantId: string
  createdAt?: string
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
  createdAt?: string
}

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

/** Ranked duration insight. `rank` and `kind` are text cues — not colour. */
export interface Insight {
  rank: number
  /** `bottleneck` (isolated call time) or `slowest` (no response pairing). */
  kind: 'bottleneck' | 'slowest'
  participant: string
  label: string
  from: string
  to: string
  messageId: string
  totalMs: number
  isolatedMs: number
}

export interface ReportOptions {
  /** Default true. When false, metrics and insights are empty. */
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
  /** Present when metrics are enabled and at least one timed message ranked. */
  insights?: Insight[]
  participants: Participant[]
  events: DiagramEvent[]
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
