// Coverage ratchet for LSD Studio, like the report UI's (modules/lsd-mono-report-html/ui): fails
// when a metric is more than MARGIN points above its threshold in vitest.config.ts, so thresholds
// are raised as tests are added. Also lists the files under LOW_LINES% of lines, which the totals hide.
// `npm test` runs it after Vitest, which writes coverage/coverage-summary.json.
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MARGIN = 3
export const LOW_LINES = 50
const METRICS = ['statements', 'branches', 'functions', 'lines']

/**
 * One message per metric in [total] (a coverage-summary.json `total`) more than [margin] points
 * above its threshold. A metric without a threshold is not held.
 */
export function staleMetrics(total, thresholds, margin = MARGIN) {
  return METRICS.filter((metric) => typeof thresholds[metric] === 'number')
    .filter((metric) => total[metric].pct > thresholds[metric] + margin)
    .map(
      (metric) =>
        `coverage ratchet: ${metric} is ${total[metric].pct}%, more than ${margin} points above its threshold ${thresholds[metric]}; raise it in vitest.config.ts`,
    )
}

/** The files in [summary] (path to metrics, plus `total`) with lines but under [limit]% of them covered. */
export function lowFiles(summary, limit = LOW_LINES) {
  return Object.entries(summary).filter(([name, m]) => name !== 'total' && m.lines.total > 0 && m.lines.pct < limit)
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { default: config } = await import('../vitest.config.ts')
  const summary = JSON.parse(readFileSync(new URL('../coverage/coverage-summary.json', import.meta.url), 'utf8'))
  const stale = staleMetrics(summary.total, config.test.coverage.thresholds)
  for (const message of stale) console.error(message)
  const low = lowFiles(summary)
  if (low.length > 0)
    console.log(
      `coverage: files under ${LOW_LINES}% of lines:\n${low.map(([name, m]) => `  ${relative(root, name)} ${m.lines.pct}%`).join('\n')}`,
    )
  if (stale.length > 0) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
