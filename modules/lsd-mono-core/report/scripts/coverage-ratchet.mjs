// Coverage ratchet for the report UI: fails when a metric is more than MARGIN points above its
// threshold in vitest.config.ts, so thresholds are raised as tests are added.
import { readFileSync } from 'node:fs'
import config from '../vitest.config.ts'

const MARGIN = 3
const thresholds = config.test.coverage.thresholds
const summary = JSON.parse(
  readFileSync(new URL('../../build/reports/coverage/report-ui/coverage-summary.json', import.meta.url), 'utf8'),
).total

const stale = Object.entries(thresholds).filter(([metric, floor]) => summary[metric].pct > floor + MARGIN)
for (const [metric, floor] of stale) {
  console.error(
    `coverage ratchet: ${metric} is ${summary[metric].pct}%, more than ${MARGIN} points above its threshold ${floor}; raise it in vitest.config.ts`,
  )
}
if (stale.length > 0) process.exit(1)
