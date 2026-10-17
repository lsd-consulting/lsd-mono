/**
 * Shared by the measure scripts in this directory: headless Chromium helpers and where results go.
 * Plain JavaScript, so the measure scripts run on Node without --experimental-strip-types.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Where the measure scripts write their JSON. */
export const RESULTS_DIR = '/tmp/lsd-perf'

export function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

/** JS heap in use, from CDP; null when the browser does not report it. */
export async function heap(page) {
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Performance.enable')
    const { metrics } = await session.send('Performance.getMetrics')
    const used = metrics.find((m) => m.name === 'JSHeapUsedSize')
    await session.detach()
    return used ? Math.round(used.value) : null
  } catch {
    return null
  }
}

/** Record long tasks into `window.__longTasks` (null when unsupported) from the first script on. */
export async function recordLongTasks(page) {
  await page.addInitScript(() => {
    window.__longTasks = []
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(entry.duration)
      }).observe({ type: 'longtask', buffered: true })
    } catch {
      window.__longTasks = null
    }
  })
}

/** Long tasks of 50 ms or more so far, and the longest; both null when unsupported. */
export async function longTaskStats(page) {
  const tasks = await page.evaluate(() => window.__longTasks)
  if (tasks == null) return { count: null, maxMs: null }
  return {
    count: tasks.filter((d) => d >= 50).length,
    maxMs: tasks.length ? Math.round(Math.max(...tasks) * 10) / 10 : 0,
  }
}

/** Write [out] to RESULTS_DIR/[name] and say so. */
export function writeResults(name, out) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const file = path.join(RESULTS_DIR, name)
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log('WROTE', file, 'chrome', out.chrome)
}
