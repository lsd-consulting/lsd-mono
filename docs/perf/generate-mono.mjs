/**
 * Rebuild the mono perf HTML (100 / 500 / 2000) with a few KB of popup
 * payload on every arrow. Method, path, and status stay in the HTML.
 * Bodies are written to a sibling payloads script and load when the inspector opens.
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
