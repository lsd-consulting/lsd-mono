/**
 * Turns an OTLP/JSON trace export (ExportTraceServiceRequest: resourceSpans, scopeSpans, spans) into
 * an LSD 1.0 report, one scenario per trace (#96, #186). Field names follow the report schema's
 * OpenTelemetry fields (trace, attributes, origin "imported"), as in the conformance report
 * otel-fields.json.
 *
 * - Each resource's `service.name` is a participant.
 * - A CLIENT span and its SERVER child become a call and its reply; a PRODUCER span and each
 *   CONSUMER child become an asynchronous message. A CLIENT with no SERVER child goes to the remote
 *   service it names (peer.service, server.address); a SERVER with no CLIENT parent is called by a
 *   "Caller" actor; a PRODUCER or CONSUMER on its own goes through a queue named by its destination.
 * - INTERNAL and unspecified spans are not drawn, only counted, though calls inside them still nest.
 * - Messages are ordered by structure first (a call, the calls it made, then its reply) and by start
 *   time among siblings, so clock skew between hosts cannot reorder a call and its children.
 * - A span with status ERROR marks its message and reply, and fails the scenario.
 *
 * Only the JSON encoding with hex ids (as the OpenTelemetry Collector's file exporter writes) is read.
 */

/**
 * What generator.name is set to, so the store can tell converted reports apart. The report UI shows
 * it in the report header.
 */
export const OTLP_GENERATOR = 'LSD Studio (OTLP import)'

/** The generator names converted reports had before, still told apart when an index is rebuilt. */
export const LEGACY_OTLP_GENERATORS: readonly string[] = ['lsd-mono-server OTLP import']

const MAX_ERRORS = 50
const TRACE_ID = /^[0-9a-f]{32}$/i
const SPAN_ID = /^[0-9a-f]{16}$/i
const KINDS = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'] as const
type Kind = (typeof KINDS)[number]

type Scalar = string | number | boolean
type AttributeValue = Scalar | string[] | number[] | boolean[]
type Attributes = Record<string, AttributeValue>

interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: Kind
  start: bigint
  end: bigint
  error: boolean
  statusMessage?: string
  attributes: Attributes
  service: string
  resource: Attributes
}

type Json = Record<string, unknown>

/** The report, or why the body is not a trace export this can read, as `path: message` lines. */
export type OtlpResult = { report: Json; errors: [] } | { report?: undefined; errors: string[] }

export function otlpToReport(body: string, now: Date = new Date()): OtlpResult {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return { errors: ['/: must be JSON'] }
  }
  const errors: string[] = []
  const spans = readSpans(json, errors)
  if (errors.length > 0) return { errors: errors.slice(0, MAX_ERRORS) }
  if (spans.length === 0) return { errors: ['/resourceSpans: has no spans'] }

  const traces = new Map<string, Span[]>()
  for (const span of spans) traces.set(span.traceId, [...(traces.get(span.traceId) ?? []), span])
  const scenarios = [...traces.values()]
    .map((trace) => trace.sort((a, b) => compare(a.start, b.start)))
    .sort((a, b) => compare(a[0].start, b[0].start))
    .map(toScenario)
  const failed = scenarios.some((scenario) => scenario.status === 'error')
  const first = scenarios[0]
  return {
    errors: [],
    report: {
      schemaVersion: '1.0.0',
      title: scenarios.length === 1 ? String(first.title) : `${scenarios.length} imported traces`,
      generatedAt: now.toISOString(),
      generator: { name: OTLP_GENERATOR },
      status: failed ? 'error' : 'success',
      scenarios,
    },
  }
}

// ---- Reading the export --------------------------------------------------------------------------

function readSpans(json: unknown, errors: string[]): Span[] {
  if (!isObject(json)) return (fail(errors, '/', 'must be an object'), [])
  const spans: Span[] = []
  each(json, 'resourceSpans', '', errors, (resourceSpans, at) => {
    const resource = isObject(resourceSpans.resource) ? attributesOf(resourceSpans.resource.attributes) : {}
    const service = typeof resource['service.name'] === 'string' ? resource['service.name'] : 'unknown_service'
    each(resourceSpans, 'scopeSpans', at, errors, (scopeSpans, at) => {
      each(scopeSpans, 'spans', at, errors, (span, at) => {
        const read = readSpan(span, at, errors)
        if (read) spans.push({ ...read, service, resource })
      })
    })
  })
  return spans
}

function readSpan(span: Json, at: string, errors: string[]): Omit<Span, 'service' | 'resource'> | undefined {
  const before = errors.length
  const id = (key: string, pattern: RegExp, optional = false): string | undefined => {
    const value = span[key]
    if (optional && (value === undefined || value === '')) return undefined
    if (typeof value === 'string' && pattern.test(value)) return value.toLowerCase()
    fail(errors, `${at}/${key}`, `must be ${pattern === TRACE_ID ? 32 : 16} hex characters`)
  }
  const traceId = id('traceId', TRACE_ID)
  const spanId = id('spanId', SPAN_ID)
  const parentSpanId = id('parentSpanId', SPAN_ID, true)
  const start = nanos(span.startTimeUnixNano, `${at}/startTimeUnixNano`, errors)
  const end = nanos(span.endTimeUnixNano, `${at}/endTimeUnixNano`, errors)
  if (typeof span.name !== 'string') fail(errors, `${at}/name`, 'must be a string')
  const kind = kindOf(span.kind)
  if (kind === undefined) fail(errors, `${at}/kind`, 'must be a span kind')
  const status = isObject(span.status) ? span.status : {}
  if (errors.length > before) return undefined
  return {
    traceId: traceId!,
    spanId: spanId!,
    parentSpanId,
    name: span.name as string,
    kind: kind!,
    start: start!,
    end: end! < start! ? start! : end!,
    error: status.code === 2 || status.code === 'STATUS_CODE_ERROR',
    statusMessage: typeof status.message === 'string' && status.message !== '' ? status.message : undefined,
    attributes: attributesOf(span.attributes),
  }
}

function each(parent: Json, key: string, at: string, errors: string[], visit: (item: Json, at: string) => void) {
  const items = parent[key]
  if (items === undefined) return
  if (!Array.isArray(items)) return fail(errors, `${at}/${key}`, 'must be an array')
  items.forEach((item: unknown, i) => {
    if (isObject(item)) visit(item, `${at}/${key}/${i}`)
    else fail(errors, `${at}/${key}/${i}`, 'must be an object')
  })
}

function nanos(value: unknown, at: string, errors: string[]): bigint | undefined {
  if (
    (typeof value === 'string' && /^\d+$/.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  ) {
    return BigInt(value)
  }
  fail(errors, at, 'must be nanoseconds since the epoch, as a string of digits')
}

function kindOf(value: unknown): Kind | undefined {
  if (value === undefined) return 'UNSPECIFIED'
  if (typeof value === 'number') return KINDS[value]
  if (typeof value === 'string') return KINDS.find((kind) => value === `SPAN_KIND_${kind}`)
}

/** OTLP KeyValue lists as plain attributes. Maps and bytes have no LSD form, so they are left out. */
function attributesOf(list: unknown): Attributes {
  const attributes: Attributes = {}
  if (!Array.isArray(list)) return attributes
  for (const entry of list) {
    if (!isObject(entry) || typeof entry.key !== 'string') continue
    const value = valueOf(entry.value)
    if (value !== undefined) attributes[entry.key] = value
  }
  return attributes
}

function valueOf(any: unknown): AttributeValue | undefined {
  if (!isObject(any)) return undefined
  if (typeof any.stringValue === 'string') return any.stringValue
  if (typeof any.boolValue === 'boolean') return any.boolValue
  if (typeof any.doubleValue === 'number') return any.doubleValue
  if (typeof any.intValue === 'number' || (typeof any.intValue === 'string' && /^-?\d+$/.test(any.intValue))) {
    return Number(any.intValue)
  }
  if (isObject(any.arrayValue) && Array.isArray(any.arrayValue.values)) {
    const values = any.arrayValue.values.map(valueOf)
    const type = typeof values[0]
    if (values.every((value) => value !== undefined && !Array.isArray(value) && typeof value === type)) {
      return values as string[] | number[] | boolean[]
    }
  }
  return undefined
}

// ---- Building a scenario -------------------------------------------------------------------------

interface Interaction {
  /** The span that starts it: the CLIENT or PRODUCER, or a SERVER or CONSUMER on its own. */
  anchor: Span
  /** The span on the receiving side, when there is one. */
  receiver?: Span
  from: string
  to: string
  async: boolean
  children: Interaction[]
}

function toScenario(spans: Span[]): Json {
  const traceId = spans[0].traceId
  const byId = new Map(spans.map((span) => [span.spanId, span]))
  const children = (span: Span, kind: Kind) =>
    spans.filter((child) => child.parentSpanId === span.spanId && child.kind === kind)
  const parentOf = (span: Span) => (span.parentSpanId ? byId.get(span.parentSpanId) : undefined)

  const participants = new Participants()
  const interactions: Interaction[] = []
  for (const span of spans) {
    const parent = parentOf(span)
    const service = participants.service(span)
    if (span.kind === 'CLIENT') {
      const servers = children(span, 'SERVER')
      if (servers.length === 0) {
        interactions.push({ anchor: span, from: service, to: participants.peer(span), async: false, children: [] })
      }
      for (const server of servers) {
        const to = participants.service(server)
        interactions.push({ anchor: span, receiver: server, from: service, to, async: false, children: [] })
      }
    } else if (span.kind === 'SERVER' && parent?.kind !== 'CLIENT') {
      const from = parent && parent.service !== span.service ? participants.service(parent) : participants.caller()
      interactions.push({ anchor: span, from, to: service, async: false, children: [] })
    } else if (span.kind === 'PRODUCER') {
      const consumers = children(span, 'CONSUMER')
      if (consumers.length === 0) {
        interactions.push({ anchor: span, from: service, to: participants.queue(span), async: true, children: [] })
      }
      for (const consumer of consumers) {
        const to = participants.service(consumer)
        interactions.push({ anchor: span, receiver: consumer, from: service, to, async: true, children: [] })
      }
    } else if (span.kind === 'CONSUMER' && parent?.kind !== 'PRODUCER') {
      interactions.push({ anchor: span, from: participants.queue(span), to: service, async: true, children: [] })
    }
  }

  // Nest each interaction under the one its nearest drawn ancestor span belongs to.
  const owner = new Map<string, Interaction>()
  for (const interaction of interactions) {
    owner.set(interaction.anchor.spanId, interaction)
    if (interaction.receiver) owner.set(interaction.receiver.spanId, interaction)
  }
  const roots: Interaction[] = []
  for (const interaction of interactions) {
    let parent = parentOf(interaction.anchor)
    const seen = new Set<string>()
    while (parent && !owner.has(parent.spanId) && !seen.has(parent.spanId)) {
      seen.add(parent.spanId)
      parent = parentOf(parent)
    }
    const into = parent ? owner.get(parent.spanId) : undefined
    if (into && into !== interaction) into.children.push(interaction)
    else roots.push(interaction)
  }

  const events: Json[] = []
  let failure: Span | undefined
  const emit = (interaction: Interaction, parentId: string | undefined) => {
    const { anchor, receiver } = interaction
    const failed = [anchor, receiver].find((span) => span?.error)
    failure ??= failed
    const attributes: Attributes = { ...anchor.attributes, ...receiver?.attributes, 'lsd.span.kind': anchor.kind }
    const code = attributes['http.response.status_code'] ?? attributes['rpc.grpc.status_code']
    const status = code !== undefined ? String(code) : failed ? 'error' : undefined
    const id = `m${events.length + 1}`
    const trace = { traceId, spanId: anchor.spanId, ...(anchor.parentSpanId && { parentSpanId: anchor.parentSpanId }) }
    events.push({
      kind: 'message',
      id,
      from: interaction.from,
      to: interaction.to,
      label: labelOf(anchor, receiver) + (failed ? ' · error' : ''),
      type: interaction.async ? 'asynchronous' : 'synchronous',
      ...(!interaction.async && { durationMs: millis(anchor.end - anchor.start) }),
      callId: anchor.spanId,
      trace,
      source: anchor.service,
      ...(status && { status }),
      timing: 'measured',
      ...(receiver && { pairing: 'trace' }),
      ...(parentId && { parentId }),
      attributes,
      origin: 'imported',
      startedAt: isoOf(anchor.start),
    })
    for (const child of bySpanStart(interaction.children)) emit(child, id)
    if (!interaction.async) {
      events.push({
        kind: 'message',
        id: `m${events.length + 1}`,
        from: interaction.to,
        to: interaction.from,
        // The report UI marks a failed reply with its own ✕.
        label: failed ? (status === 'error' ? 'error' : `${status} error`) : (status ?? 'ok'),
        type: 'synchronous_response',
        callId: anchor.spanId,
        replyTo: id,
        trace: { traceId, spanId: anchor.spanId },
        source: anchor.service,
        ...(status && { status }),
        pairing: 'trace',
        origin: 'imported',
      })
    }
  }
  for (const root of bySpanStart(roots)) emit(root, undefined)

  const root = spans.find((span) => !span.parentSpanId || !byId.has(span.parentSpanId)) ?? spans[0]
  const hidden = spans.filter((span) => span.kind === 'INTERNAL' || span.kind === 'UNSPECIFIED').length
  const services = [...new Set(spans.map((span) => span.service))]
  // The report UI's Accuracy card reads these shares; a JVM report gets them from the core.
  // Calls are the synchronous messages; one is paired when a reply names it, as the core counts.
  const calls = events.filter((event) => event.type === 'synchronous')
  const answered = new Set(events.map((event) => event.replyTo))
  const share = (count: number) => (calls.length ? { value: count / calls.length } : undefined)
  const measured = share(calls.filter((call) => call.durationMs !== undefined).length)
  const paired = share(calls.filter((call) => answered.has(call.id)).length)
  return {
    id: `trace-${traceId}`,
    title: `${root.name} (trace ${traceId.slice(0, 8)})`,
    status: failure ? 'error' : 'success',
    description: `Imported from OpenTelemetry spans: ${spans.length} spans from ${services.length} services.`,
    ...(failure && {
      error: {
        headline: `${failure.name} failed`,
        message: failure.statusMessage ?? `The ${failure.service} span has status ERROR.`,
      },
    }),
    facts: [
      { key: 'traceId', value: traceId },
      { key: 'Spans', value: String(spans.length) },
      { key: 'Services', value: services.join(', ') },
      ...(hidden > 0 ? [{ key: 'Internal spans not drawn', value: String(hidden) }] : []),
    ],
    participants: participants.all(),
    events,
    accuracy: 'traced',
    ...(measured && { measuredRatio: measured.value }),
    ...(paired && { pairedRatio: paired.value }),
    sources: services,
  }
}

/** A label from the semantic conventions, else the span's name. */
function labelOf(anchor: Span, receiver: Span | undefined): string {
  const a = { ...anchor.attributes, ...receiver?.attributes }
  const method = a['http.request.method'] ?? a['http.method']
  const route = a['http.route'] ?? a['url.path'] ?? a['http.target']
  if (method !== undefined) return [method, route].filter((part) => part !== undefined).join(' ')
  if (a['rpc.method'] !== undefined) return [a['rpc.service'], a['rpc.method']].filter(Boolean).join('/')
  const destination = a['messaging.destination.name']
  if (destination !== undefined) return String(destination)
  return (receiver ?? anchor).name
}

class Participants {
  private readonly list: Json[] = []
  private readonly ids = new Map<string, string>()

  service(span: Span): string {
    const attributes = Object.fromEntries(Object.entries(span.resource).filter(([key]) => key.startsWith('service.')))
    return this.add(`service:${span.service}`, span.service, 'participant', attributes)
  }

  caller(): string {
    return this.add('caller', 'Caller', 'actor')
  }

  peer(span: Span): string {
    const name = span.attributes['peer.service'] ?? span.attributes['server.address'] ?? span.attributes['db.system']
    const label = name === undefined ? `${span.name} (remote)` : String(name)
    return this.add(`peer:${label}`, label, 'participant', { 'peer.service': label, 'lsd.external': true })
  }

  queue(span: Span): string {
    const name = String(span.attributes['messaging.destination.name'] ?? span.name)
    return this.add(`queue:${name}`, name, 'queue')
  }

  /** In first-seen order, with the Caller actor leftmost where a diagram reads from. */
  all(): Json[] {
    return [...this.list.filter((p) => p.type === 'actor'), ...this.list.filter((p) => p.type !== 'actor')]
  }

  private add(key: string, name: string, type: string, attributes?: Attributes): string {
    const known = this.ids.get(key)
    if (known) return known
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'participant'
    let id = base
    for (let n = 2; [...this.ids.values()].includes(id); n++) id = `${base}-${n}`
    this.ids.set(key, id)
    const hasAttributes = attributes && Object.keys(attributes).length > 0
    this.list.push({ id, name, type, ...(hasAttributes && { attributes }) })
    return id
  }
}

// ---- Helpers -------------------------------------------------------------------------------------

function bySpanStart(interactions: Interaction[]): Interaction[] {
  return [...interactions].sort((a, b) => compare(a.anchor.start, b.anchor.start))
}

function compare(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Nanoseconds as milliseconds to the microsecond. */
function millis(ns: bigint): number {
  return Number(ns / 1000n) / 1000
}

function isoOf(ns: bigint): string {
  return new Date(Number(ns / 1_000_000n)).toISOString()
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(errors: string[], at: string, message: string): void {
  errors.push(`${at || '/'}: ${message}`)
}
