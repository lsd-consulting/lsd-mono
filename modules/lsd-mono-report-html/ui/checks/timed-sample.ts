import { REPORT_SCHEMA_VERSION, type MessageEvent, type Participant, type Report } from '../src/types'

/**
 * The Timing view's call trees (#90a), the same shape as the timed-<calls> perf pages that
 * docs/perf/generate-mono.mjs writes (#69), for the check:ux tests that open the Timing view.
 *
 * Each request is a call tree with start times and durations on two clocks: the api's own calls
 * carry `startedAt` on the scenario's clock, and the orders service's calls come from a second
 * source, so they are packed inside their parent as the core does. Every call has its reply
 * (`replyOf`), and each request ends with an untimed async publish inside its root call.
 */
export const timedParticipants: Participant[] = [
  { id: 'client', name: 'Client', type: 'ACTOR' },
  { id: 'api', name: 'Api', type: 'PARTICIPANT' },
  { id: 'auth', name: 'Auth', type: 'PARTICIPANT' },
  { id: 'orders', name: 'Orders', type: 'PARTICIPANT' },
  { id: 'database', name: 'Database', type: 'DATABASE' },
  { id: 'payments', name: 'Payments', type: 'PARTICIPANT' },
  { id: 'events', name: 'Events', type: 'QUEUE' },
]

interface Step {
  key: string
  from: string
  to: string
  label: string
  /** ms after the request starts. */
  at?: number
  ms: number
  /** The call (by key) it runs inside. */
  parent?: string
  source: string
  path: string
}

const request: Step[] = [
  { key: 'root', from: 'client', to: 'api', label: 'place order', at: 0, ms: 34, source: 'api', path: '/v1/orders' },
  {
    key: 'auth',
    from: 'api',
    to: 'auth',
    label: 'check token',
    at: 1,
    ms: 3.4,
    parent: 'root',
    source: 'api',
    path: '/v1/token',
  },
  {
    key: 'orders',
    from: 'api',
    to: 'orders',
    label: 'create order',
    at: 6,
    ms: 22,
    parent: 'root',
    source: 'api',
    path: '/v1/orders',
  },
  {
    key: 'db',
    from: 'orders',
    to: 'database',
    label: 'insert order',
    ms: 8.5,
    parent: 'orders',
    source: 'orders',
    path: '/orders',
  },
  {
    key: 'pay',
    from: 'orders',
    to: 'payments',
    label: 'charge',
    ms: 9,
    parent: 'orders',
    source: 'orders',
    path: '/v1/charges',
  },
]
export const CALLS_PER_REQUEST = request.length

/** [calls] timed calls (a multiple of five). [payload] gives a call's data; the check:ux tests leave it out. */
export function timedReport(
  calls: number,
  payload: (step: { label: string; path: string }, id: number) => unknown = () => undefined,
): Report {
  const events: MessageEvent[] = []
  let id = 1
  const t0 = Date.parse('2026-10-19T09:00:00Z')
  const requests = calls / CALLS_PER_REQUEST
  for (let r = 0; r < requests; r++) {
    const begin = t0 + r * 40
    const ids: Record<string, string> = {}
    const replies: MessageEvent[] = []
    for (const step of request) {
      const callId = String(id++)
      ids[step.key] = callId
      const call: MessageEvent = {
        kind: 'message',
        id: callId,
        from: step.from,
        to: step.to,
        label: step.label,
        type: 'SYNCHRONOUS',
        source: step.source,
        durationMs: step.ms,
        timing: 'MEASURED',
        pairing: 'CALL_ID',
      }
      const data = payload({ label: step.label, path: `${step.path}/${callId}` }, Number(callId))
      if (data !== undefined) call.data = data
      if (step.at != null) call.startedAt = new Date(begin + step.at).toISOString()
      if (step.parent) call.parentId = ids[step.parent]
      events.push(call)
      // A leaf replies at once; a parent replies after its children (below).
      const reply: MessageEvent = {
        kind: 'message',
        id: '',
        from: step.to,
        to: step.from,
        label: '200 OK',
        type: 'SYNCHRONOUS_RESPONSE',
        source: step.source,
        replyOf: callId,
        pairing: 'CALL_ID',
      }
      if (step.parent) reply.parentId = ids[step.parent]
      if (step.key === 'root' || step.key === 'orders') replies.push(reply)
      else {
        reply.id = String(id++)
        events.push(reply)
      }
    }
    for (const reply of replies.reverse()) {
      reply.id = String(id++)
      events.push(reply)
    }
    events.push({
      kind: 'message',
      id: String(id++),
      from: 'api',
      to: 'events',
      label: 'order placed',
      type: 'ASYNCHRONOUS',
      source: 'api',
      startedAt: new Date(begin + 35).toISOString(),
      parentId: ids.root,
    })
  }
  const wallClockMs = (requests - 1) * 40 + 36
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    title: `timed-${calls}`,
    generatedAt: new Date().toISOString(),
    generator: 'lsd-mono-core perf fixture',
    status: 'success',
    options: { metricsEnabled: true, labelMaxWidth: 200, usagePing: false, source: 'api' },
    scenarios: [
      {
        id: String(calls + 3),
        title: `Timed calls ${calls}`,
        status: 'success',
        description: 'Synthetic perf fixture for the Timing view: nested timed calls on two clocks',
        facts: [],
        metrics: [{ key: 'Calls', value: String(calls) }],
        participants: timedParticipants,
        events,
        accuracy: 'MEASURED',
        measuredCoverage: 1,
        pairingCoverage: 1,
        sources: ['api', 'orders'],
        wallClockMs,
        clockOrdering: 'SAME_SOURCE',
        clockOrdered: 0,
        warnings: [],
        pairAccuracy: [
          { from: 'client', to: 'api', accuracy: 'MEASURED' },
          { from: 'orders', to: 'database', accuracy: 'TIMESTAMPED' },
        ],
      },
    ],
  }
}
