// Coverage ratchet for LSD Studio, like the report UI's (modules/lsd-mono-report-html/ui): fails
// when a metric is more than MARGIN points above its threshold in vitest.config.ts, so thresholds
// are raised as tests are added. Also lists the files under LOW_LINES% of lines, which the totals hide.
// `npm test` runs it after Vitest, which writes coverage/coverage-summary.json. It always runs when
// loaded, with no "am I the main module" guard, so no way of starting it (a symlinked path, another
// drive-letter case) can skip the check. The rules are in coverage-ratchet-lib.mjs.
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOW_LINES, lowFiles, staleMetrics } from './coverage-ratchet-lib.mjs'
import config from '../vitest.config.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const summary = JSON.parse(readFileSync(new URL('../coverage/coverage-summary.json', import.meta.url), 'utf8'))
const stale = staleMetrics(summary.total, config.test.coverage.thresholds)
for (const message of stale) console.error(message)
const low = lowFiles(summary)
if (low.length > 0)
  console.log(
    `coverage: files under ${LOW_LINES}% of lines:\n${low.map(([name, m]) => `  ${relative(root, name)} ${m.lines.pct}%`).join('\n')}`,
  )
if (stale.length > 0) process.exit(1)
