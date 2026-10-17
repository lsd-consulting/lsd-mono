/**
 * Shared by the perf generators in this directory: the synthetic arrow payload and writing a
 * sample page into the report shell. It imports the report's payloads.ts, so run the generators
 * with --experimental-strip-types.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { shellParts } from '../../modules/lsd-mono-core/report/src/lib/payloads.ts'

/** A few KB of HTTP-like popup payload for message [n]; bodies go to the sibling payloads script. */
export function arrowPayload(label, n, { method = 'POST', path: route = `/v1/hop/${n}`, status = 200 } = {}) {
  const items = []
  for (let i = 0; i < 12; i++) {
    items.push({
      sku: `SOCK-${n}-${i}`,
      name: 'Merino hiking sock, crew length',
      qty: 1 + (i % 3),
      warehouse: i % 2 === 0 ? 'LDN-1' : 'MAN-2',
      note: `allocation ${n}.${i} reserved against cart line, payment intent, and fraud score`,
    })
  }
  return {
    method,
    path: route,
    status,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-request-id': `req-${n}-${label.replace(/\s+/g, '-')}`,
      'x-trace': `trace-${n}-${'abcdef0123456789'.repeat(6)}`,
    },
    body: {
      marker: 'arrow-payload',
      orderId: `ord_${n}`,
      label,
      items,
      comment: `Captured ${label} body for message ${n}. `.repeat(8).trim(),
    },
  }
}

/** Read `<shell.html> <out-dir>` from the command line, or exit with [usage]. */
export function generatorArgs(usage) {
  const [shellPath, outDir] = process.argv.slice(2)
  if (!shellPath || !outDir) {
    console.error(`usage: ${usage}`)
    process.exit(1)
  }
  const shell = readFileSync(shellPath, 'utf8')
  if (!shell.includes('<script>')) throw new Error('shell has no script tag')
  mkdirSync(outDir, { recursive: true })
  return { shell, outDir }
}

/** Write `<stem>-diagram.html` and its deferred `<stem>-payloads.js`, as lsd-mono-core does. */
export function writeSample(shell, outDir, stem, report) {
  const parts = shellParts(report, `${stem}-payloads.js`)
  if (!parts.payloadsJs) throw new Error('expected deferred payloads')
  if (parts.htmlScript.includes('arrow-payload')) throw new Error('body leaked into the report script')
  const idx = shell.indexOf('<script>')
  const html = shell.slice(0, idx) + parts.htmlScript + shell.slice(idx)
  const file = path.join(outDir, `${stem}-diagram.html`)
  writeFileSync(file, html)
  writeFileSync(path.join(outDir, `${stem}-payloads.js`), parts.payloadsJs)
  return { file, htmlBytes: Buffer.byteLength(html), payloadBytes: Buffer.byteLength(parts.payloadsJs) }
}
