/**
 * Rebuild the mono perf HTML (100 / 500 / 2000) with a few KB of popup
 * payload on every arrow. Method, path, and status stay in the HTML.
 * Bodies are written to a sibling payloads script and load when the inspector opens.
 * Also writes timed-<calls>-diagram.html (100 / 500 / 2000 calls) for the Timing view (#69): see timedReportFor.
 *
 * Usage: node generate-mono.mjs <shell.html> <out-dir>
 */
import { arrowPayload, generatorArgs, writeSample } from './sample-kit.mjs'

const { shell, outDir } = generatorArgs('node --experimental-strip-types generate-mono.mjs <shell.html> <out-dir>')

const participants = [
  { id: 'client', name: 'Client', type: 'PARTICIPANT' },
  { id: 'api', name: 'Api', type: 'PARTICIPANT' },
  { id: 'payments', name: 'Payments', type: 'PARTICIPANT' },
  { id: 'database', name: 'Database', type: 'PARTICIPANT' },
]

// Each cycle nests: place order → charge → insert, and the database replies to the insert.
// `parent` and `replyOf` are offsets back to the event they point at, as the core writes
// parentId and replyOf, so the Timing view's tree is exercised too.
const cycle = [
  { from: 'client', to: 'api', label: 'place order', type: 'SYNCHRONOUS', method: 'POST', path: '/v1/orders', status: 202 },
  { from: 'api', to: 'payments', label: 'charge', type: 'SYNCHRONOUS', durationMs: 15, parent: 1, method: 'POST', path: '/v1/charges', status: 201 },
  { from: 'payments', to: 'database', label: 'insert', type: 'SYNCHRONOUS', parent: 1, method: 'POST', path: '/orders', status: 200 },
  { from: 'database', to: 'payments', label: 'ok', type: 'SYNCHRONOUS_RESPONSE', replyOf: 1, method: 'POST', path: '/orders', status: 200 },
]

function payload(step, n) {
  return arrowPayload(step.label, n, { method: step.method, path: `${step.path}/${n}`, status: step.status })
}

function reportFor(size) {
  const events = []
  let id = 1
  const cycles = size / cycle.length
  for (let c = 0; c < cycles; c++) {
    for (const step of cycle) {
      const data = payload(step, id)
      const event = {
        kind: 'message',
        id: String(id),
        from: step.from,
        to: step.to,
        label: step.label,
        type: step.type,
        data,
      }
      if (step.durationMs != null) event.durationMs = step.durationMs
      if (step.parent) event.parentId = String(id - step.parent)
      if (step.replyOf) event.replyOf = String(id - step.replyOf)
      events.push(event)
      id++
    }
  }
  events.push({
    kind: 'note',
    id: String(id),
    text: `needle-${size}`,
    over: 'api',
    placement: 'over',
  })
  const chargeCount = cycles
  return {
    title: `mono-${size}`,
    generatedAt: new Date().toISOString(),
    generator: 'lsd-mono-core perf fixture',
    status: 'success',
    options: { metricsEnabled: true, labelMaxWidth: 200 },
    scenarios: [
      {
        id: String(size + 2),
        title: `Large sequence ${size}`,
        status: 'success',
        description: 'Synthetic perf fixture with per-arrow popup payloads',
        facts: [],
        metrics: [
          { key: 'Messages', value: String(size) },
          { key: 'Captured duration', value: `${chargeCount * 15} ms` },
        ],
        participants,
        events,
      },
    ],
  }
}

console.log('payload bytes', Buffer.byteLength(JSON.stringify(payload(cycle[0], 1))))

for (const size of [100, 500, 2000]) {
  const report = reportFor(size)
  const { file, htmlBytes, payloadBytes } = writeSample(shell, outDir, `mono-${size}`, report)
  const messages = report.scenarios[0].events.filter((e) => e.kind === 'message')
  console.log(`wrote ${file} messages=${messages.length} htmlBytes=${htmlBytes} payloadBytes=${payloadBytes}`)
}

// Timing view samples (#69). Each request is a call tree with start times and durations on two
// clocks: the api's own calls carry `startedAt` on the scenario's clock, and the orders service's
// calls come from a second source, so they are packed inside their parent as the core does.
// Every call has its reply (`replyOf`), and each request ends with an untimed async publish inside its root call.
const timedParticipants = [
  { id: 'client', name: 'Client', type: 'ACTOR' },
  { id: 'api', name: 'Api', type: 'PARTICIPANT' },
  { id: 'auth', name: 'Auth', type: 'PARTICIPANT' },
  { id: 'orders', name: 'Orders', type: 'PARTICIPANT' },
  { id: 'database', name: 'Database', type: 'DATABASE' },
  { id: 'payments', name: 'Payments', type: 'PARTICIPANT' },
  { id: 'events', name: 'Events', type: 'QUEUE' },
]

// `parent` names the call (by key) it runs inside; `at` is ms after the request starts.
const request = [
  { key: 'root', from: 'client', to: 'api', label: 'place order', at: 0, ms: 34, source: 'api', path: '/v1/orders' },
  { key: 'auth', from: 'api', to: 'auth', label: 'check token', at: 1, ms: 3.4, parent: 'root', source: 'api', path: '/v1/token' },
  { key: 'orders', from: 'api', to: 'orders', label: 'create order', at: 6, ms: 22, parent: 'root', source: 'api', path: '/v1/orders' },
  { key: 'db', from: 'orders', to: 'database', label: 'insert order', ms: 8.5, parent: 'orders', source: 'orders', path: '/orders' },
  { key: 'pay', from: 'orders', to: 'payments', label: 'charge', ms: 9, parent: 'orders', source: 'orders', path: '/v1/charges' },
]
const CALLS_PER_REQUEST = request.length

function timedReportFor(calls) {
  const events = []
  let id = 1
  const t0 = Date.parse('2026-10-19T09:00:00Z')
  const requests = calls / CALLS_PER_REQUEST
  for (let r = 0; r < requests; r++) {
    const begin = t0 + r * 40
    const ids = {}
    const replies = []
    for (const step of request) {
      const callId = String(id++)
      ids[step.key] = callId
      const call = {
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
        data: arrowPayload(step.label, Number(callId), { path: `${step.path}/${callId}`, status: 200 }),
      }
      if (step.at != null) call.startedAt = new Date(begin + step.at).toISOString()
      if (step.parent) call.parentId = ids[step.parent]
      events.push(call)
      // A leaf replies at once; a parent replies after its children (below).
      const reply = {
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
    title: `timed-${calls}`,
    generatedAt: new Date().toISOString(),
    generator: 'lsd-mono-core perf fixture',
    status: 'success',
    options: { metricsEnabled: true, labelMaxWidth: 200 },
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

for (const calls of [100, 500, 2000]) {
  const report = timedReportFor(calls)
  const { file, htmlBytes, payloadBytes } = writeSample(shell, outDir, `timed-${calls}`, report)
  const events = report.scenarios[0].events
  console.log(`wrote ${file} calls=${calls} events=${events.length} htmlBytes=${htmlBytes} payloadBytes=${payloadBytes}`)
}
