/**
 * Wide-participant mono reports. Payloads stay in a sibling script.
 *
 * Usage: node --experimental-strip-types generate-wide.mjs <shell.html> <out-dir>
 *
 * Cases: 20 / 50 / 100 participants at 400 messages, plus 100 participants at 2000.
 * The first arrow is a short left-hand hop so Fit's top label stays near the origin.
 * Later arrows hop across the diagram, including a full-width span every 25th message.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { shellParts } from '../../modules/lsd-mono-core/report/src/lib/payloads.ts'

const shellPath = process.argv[2]
const outDir = process.argv[3]
if (!shellPath || !outDir) {
  console.error('usage: node --experimental-strip-types generate-wide.mjs <shell.html> <out-dir>')
  process.exit(1)
}

const shell = readFileSync(shellPath, 'utf8')
const marker = '<script>'
const idx = shell.indexOf(marker)
if (idx < 0) throw new Error('shell has no script tag')

const KINDS = [
  { type: 'ACTOR', name: 'User' },
  { type: 'DATABASE', name: 'Orders' },
  { type: 'QUEUE', name: 'Queue' },
  { type: 'PARTICIPANT', name: 'Api' },
  { type: 'ENTITY', name: 'Entity' },
  { type: 'BOUNDARY', name: 'Edge' },
]

const CASES = [
  { participants: 20, messages: 400 },
  { participants: 50, messages: 400 },
  { participants: 100, messages: 400 },
  { participants: 100, messages: 2000 },
]

function participantsFor(count) {
  const list = []
  for (let i = 0; i < count; i++) {
    const kind = KINDS[i % KINDS.length]
    const n = String(i + 1).padStart(2, '0')
    list.push({
      id: `p${n}`,
      name: `${kind.name} ${n}`,
      type: kind.type,
    })
  }
  return list
}

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
    method: 'POST',
    path: `/v1/hop/${n}`,
    status: 200,
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

function stepFor(i, count) {
  const from = i % count
  if (i % 25 === 24) {
    return { from, to: count - 1, label: 'span all' }
  }
  const hop = 1 + (i % Math.max(1, count - 1))
  let to = (from + hop) % count
  if (to === from) to = (from + 1) % count
  const label = hop > count / 2 ? 'cross' : 'hop'
  return { from, to, label }
}

function reportFor(count, size) {
  const participants = participantsFor(count)
  const events = []
  for (let i = 0; i < size; i++) {
    const step = stepFor(i, count)
    const id = i + 1
    const type = id % 4 === 0 ? 'SYNCHRONOUS_RESPONSE' : 'SYNCHRONOUS'
    const event = {
      kind: 'message',
      id: String(id),
      from: participants[step.from].id,
      to: participants[step.to].id,
      label: step.label,
      type,
      data: payload(step, id),
    }
    if (id % 4 === 2) event.durationMs = 15
    events.push(event)
  }
  events.push({
    kind: 'note',
    id: String(size + 1),
    text: `needle-p${count}-m${size}`,
    over: participants[0].id,
    placement: 'over',
  })
  return {
    title: `mono-p${count}-m${size}`,
    generatedAt: new Date().toISOString(),
    generator: 'lsd-mono-core wide perf fixture',
    status: 'success',
    options: { metricsEnabled: true, labelMaxWidth: 200 },
    scenarios: [
      {
        id: `wide-p${count}-m${size}`,
        title: `${count} participants, ${size} messages`,
        status: 'success',
        description: 'Synthetic wide-participant perf fixture. Payloads load when the inspector opens.',
        facts: [],
        metrics: [
          { key: 'Participants', value: String(count) },
          { key: 'Messages', value: String(size) },
        ],
        insights: [],
        participants,
        events,
      },
    ],
  }
}

mkdirSync(outDir, { recursive: true })
const sample = payload({ label: 'hop' }, 1)
console.log('payload bytes', Buffer.byteLength(JSON.stringify(sample)))

for (const spec of CASES) {
  const report = reportFor(spec.participants, spec.messages)
  const stem = `mono-p${spec.participants}-m${spec.messages}`
  const parts = shellParts(report, `${stem}-payloads.js`)
  if (!parts.payloadsJs) throw new Error('expected deferred payloads')
  if (parts.htmlScript.includes('arrow-payload')) throw new Error('body leaked into the report script')
  const html = shell.slice(0, idx) + parts.htmlScript + shell.slice(idx)
  const file = path.join(outDir, `${stem}-diagram.html`)
  const payloadsFile = path.join(outDir, `${stem}-payloads.js`)
  writeFileSync(file, html)
  writeFileSync(payloadsFile, parts.payloadsJs)
  const types = new Set(report.scenarios[0].participants.map((p) => p.type))
  console.log(
    `wrote ${file} participants=${spec.participants} messages=${spec.messages} types=${[...types].join(',')} htmlBytes=${Buffer.byteLength(html)} payloadBytes=${Buffer.byteLength(parts.payloadsJs)}`,
  )
}
