/**
 * Rebuild the mono perf HTML (100 / 500 / 2000) with a few KB of popup
 * payload on every arrow. Injects into the packaged single-file shell.
 *
 * Usage: node generate-mono.mjs <shell.html> <out-dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const shellPath = process.argv[2]
const outDir = process.argv[3]
if (!shellPath || !outDir) {
  console.error('usage: node generate-mono.mjs <shell.html> <out-dir>')
  process.exit(1)
}

const shell = readFileSync(shellPath, 'utf8')
const marker = '<script>'
const idx = shell.indexOf(marker)
if (idx < 0) throw new Error('shell has no script tag')

const participants = [
  { id: 'client', name: 'Client', type: 'PARTICIPANT' },
  { id: 'api', name: 'Api', type: 'PARTICIPANT' },
  { id: 'payments', name: 'Payments', type: 'PARTICIPANT' },
  { id: 'database', name: 'Database', type: 'PARTICIPANT' },
]

const cycle = [
  { from: 'client', to: 'api', label: 'place order', type: 'SYNCHRONOUS', method: 'POST', path: '/v1/orders', status: 202 },
  { from: 'api', to: 'payments', label: 'charge', type: 'SYNCHRONOUS', durationMs: 15, method: 'POST', path: '/v1/charges', status: 201 },
  { from: 'payments', to: 'database', label: 'insert', type: 'SYNCHRONOUS', method: 'POST', path: '/orders', status: 200 },
  { from: 'database', to: 'payments', label: 'ok', type: 'SYNCHRONOUS_RESPONSE', method: 'POST', path: '/orders', status: 200 },
]

function payload(step, n) {
  const lines = []
  for (let i = 0; i < 12; i++) {
    lines.push({
      sku: `SOCK-${n}-${i}`,
      name: 'Merino hiking sock, crew length',
      qty: 1 + (i % 3),
      warehouse: i % 2 === 0 ? 'LDN-1' : 'MAN-2',
      note: `allocation ${n}.${i} reserved against cart line, payment intent, and fraud score`,
    })
  }
  return {
    method: step.method,
    path: `${step.path}/${n}`,
    status: step.status,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-request-id': `req-${n}-${step.label.replace(/\s+/g, '-')}`,
      'x-trace': `trace-${n}-${'abcdef0123456789'.repeat(6)}`,
    },
    body: {
      marker: 'arrow-payload',
      orderId: `ord_${n}`,
      label: step.label,
      items: lines,
      comment: `Captured ${step.label} body for message ${n}. `.repeat(8).trim(),
    },
  }
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
          { key: 'Bottleneck 1', value: 'payments rank 1 isolated 15 ms (total 15 ms) — charge' },
        ],
        insights: [
          {
            rank: 1,
            kind: 'bottleneck',
            participant: 'payments',
            label: 'charge',
            from: 'api',
            to: 'payments',
            messageId: '2',
            totalMs: 15,
            isolatedMs: 15,
          },
        ],
        participants,
        events,
      },
    ],
  }
}

mkdirSync(outDir, { recursive: true })
const sample = payload(cycle[0], 1)
const sampleBytes = Buffer.byteLength(JSON.stringify(sample))
console.log('payload bytes', sampleBytes)

for (const size of [100, 500, 2000]) {
  const report = reportFor(size)
  let json = JSON.stringify(report, null, 2)
  json = json.replace(/</g, '\\u003c')
  const html = shell.slice(0, idx) + `<script>window.__LSD_REPORT__=${json};</script>\n` + shell.slice(idx)
  const file = path.join(outDir, `mono-${size}-diagram.html`)
  writeFileSync(file, html)
  const messages = report.scenarios[0].events.filter((e) => e.kind === 'message')
  console.log(`wrote ${file} messages=${messages.length} htmlBytes=${Buffer.byteLength(html)}`)
}
