// The rules of scripts/coverage-ratchet.mjs, apart from the file reading, so they can be tested.

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
