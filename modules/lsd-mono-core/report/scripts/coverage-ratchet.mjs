// Coverage ratchet for the report UI: fails when a metric is more than MARGIN points above its
// threshold in vitest.config.ts, overall or for one of its globs (`src/ui/**`), so thresholds are
// raised as tests are added. Also lists the files under LOW_LINES% of lines, which the totals hide.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { relative } from 'node:path'
import config from '../vitest.config.ts'

const MARGIN = 3
const LOW_LINES = 50
const METRICS = ['statements', 'branches', 'functions', 'lines']
const root = fileURLToPath(new URL('..', import.meta.url))
const summary = JSON.parse(
  readFileSync(new URL('../../build/reports/coverage/report-ui/coverage-summary.json', import.meta.url), 'utf8'),
)
const files = Object.entries(summary)
  .filter(([name]) => name !== 'total')
  .map(([name, metrics]) => [relative(root, name), metrics])

/** Covered over total for the files under a `dir/**` glob, as a percentage per metric. */
function globSummary(glob) {
  if (!glob.endsWith('/**')) throw new Error(`coverage ratchet: only dir/** globs are supported, not ${glob}`)
  const dir = glob.slice(0, -2)
  const matched = files.filter(([name]) => name.startsWith(dir))
  return Object.fromEntries(
    METRICS.map((metric) => {
      const total = matched.reduce((sum, [, m]) => sum + m[metric].total, 0)
      const covered = matched.reduce((sum, [, m]) => sum + m[metric].covered, 0)
      return [metric, { pct: total ? Math.round((10000 * covered) / total) / 100 : 100 }]
    }),
  )
}

const thresholds = config.test.coverage.thresholds
const checks = [['overall', summary.total, Object.entries(thresholds).filter(([, floor]) => typeof floor === 'number')]]
for (const [glob, floors] of Object.entries(thresholds))
  if (typeof floors === 'object') checks.push([glob, globSummary(glob), Object.entries(floors)])

let stale = 0
for (const [scope, actual, floors] of checks)
  for (const [metric, floor] of floors)
    if (actual[metric].pct > floor + MARGIN) {
      stale++
      console.error(
        `coverage ratchet: ${scope} ${metric} is ${actual[metric].pct}%, more than ${MARGIN} points above its threshold ${floor}; raise it in vitest.config.ts`,
      )
    }

const low = files.filter(([, m]) => m.lines.total > 0 && m.lines.pct < LOW_LINES)
if (low.length > 0)
  console.log(
    `coverage: files under ${LOW_LINES}% of lines (unit tests only):\n${low.map(([name, m]) => `  ${name} ${m.lines.pct}%`).join('\n')}`,
  )
if (stale > 0) process.exit(1)
