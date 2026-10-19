/**
 * Headless Chromium timings for the Timing view (#69) on the timed samples from
 * generate-mono.mjs (timed-100 / 500 / 2000 calls). Same approach as measure.mjs:
 * Playwright Chromium, viewport 1440×900, file://.
 *
 * For each page: open the Timing view from the scenario's Wall-clock chip, timed in the page
 * from the click to the frame after (the view is built in the click handler), the long tasks
 * in it, and the DOM nodes before and after. Then the p95 frame time while the side panel
 * scrolls through the waterfall, and the time from clicking a waterfall row halfway down to
 * its arrow being drawn in the diagram. `cpu` above 1 throttles the CPU that many times.
 *
 * Usage: node measure-timing.mjs /path/to/docs/perf-samples [timed-2000:4]
 */
import { chromium } from '../../modules/lsd-mono-core/report/node_modules/playwright/index.mjs'
import path from 'node:path'
import { heap, percentile, recordLongTasks, writeResults } from './perf-kit.mjs'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node measure-timing.mjs <samples-dir> [stem:cpu]')
  process.exit(1)
}

const only = process.argv[3]
const all = []
for (const cpu of [1, 4]) for (const calls of [100, 500, 2000]) all.push({ stem: `timed-${calls}`, calls, cpu })
const cases = only ? all.filter((c) => `${c.stem}:${c.cpu}` === only) : all
const RUNS = 3

const median = (values) => percentile(values, 50)
const browser = await chromium.launch({ headless: true })
const version = browser.version()
const results = []

async function once(spec) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await recordLongTasks(page)
  const session = await context.newCDPSession(page)
  try {
    await page.goto('file://' + path.resolve(dir, `${spec.stem}-diagram.html`))
    await page.waitForSelector('.seq-sticky-header', { state: 'visible' })
    await page.waitForLoadState('load')
    await page.waitForTimeout(300)
    if (spec.cpu > 1) await session.send('Emulation.setCPUThrottlingRate', { rate: spec.cpu })
    const nodesBefore = await page.evaluate(() => document.getElementsByTagName('*').length)

    const open = await page.evaluate(async () => {
      window.__longTasks = window.__longTasks && []
      const chip = document.querySelector('.timing-chip')
      if (!chip) return { error: 'no timing chip' }
      const t0 = performance.now()
      chip.click()
      const built = performance.now() - t0
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
      const ms = performance.now() - t0
      await new Promise((r) => setTimeout(r, 200))
      const tasks = window.__longTasks
      return {
        ms,
        built,
        rows: document.querySelectorAll('#inspector .waterfall > li').length,
        laneBars: document.querySelectorAll('#inspector .lane-bar').length,
        panelNodes: document.querySelectorAll('#inspector *').length,
        longTasks: tasks == null ? null : tasks.filter((d) => d >= 50).length,
        longTaskMaxMs: tasks && tasks.length ? Math.max(...tasks) : 0,
      }
    })
    if (open.error) throw new Error(open.error)
    const nodesAfter = await page.evaluate(() => document.getElementsByTagName('*').length)

    const scroll = await page.evaluate(async () => {
      window.__longTasks = window.__longTasks && []
      const scroller = document.querySelector('#inspector')
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const frames = []
      let last = performance.now()
      const t0 = last
      await new Promise((resolve) => {
        const tick = (now) => {
          frames.push(now - last)
          last = now
          const p = Math.min(1, (now - t0) / 2000)
          scroller.scrollTop = max * p
          if (p >= 1) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      const tasks = window.__longTasks
      return { frames, max, longTasks: tasks == null ? null : tasks.filter((d) => d >= 50).length }
    })

    const jump = await page.evaluate(async () => {
      window.__longTasks = window.__longTasks && []
      const rows = document.querySelectorAll('#inspector .wf-row')
      const row = rows[Math.floor(rows.length / 2)]
      row.scrollIntoView({ block: 'center' })
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)))
      const id = row.dataset.showMessage
      const drawn = () => document.querySelector(`.seq-scroll button.msg-open[data-message-id="${id}"]`)
      const t0 = performance.now()
      row.click()
      while (!drawn() && performance.now() - t0 < 5000) await new Promise((r) => requestAnimationFrame(r))
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
      const ms = performance.now() - t0
      const tasks = window.__longTasks
      return {
        ms,
        id,
        drawn: Boolean(drawn()),
        longTaskMaxMs: tasks && tasks.length ? Math.max(...tasks) : 0,
      }
    })
    if (!jump.drawn) throw new Error(`message ${jump.id} not drawn after the row click`)
    return {
      openMs: open.ms,
      buildMs: open.built,
      openLongTasks: open.longTasks,
      openLongTaskMaxMs: open.longTaskMaxMs,
      rows: open.rows,
      laneBars: open.laneBars,
      panelNodes: open.panelNodes,
      nodesBefore,
      nodesAfter,
      p95FrameMs: percentile(scroll.frames, 95),
      longestFrameMs: Math.max(...scroll.frames),
      scrollLongTasks: scroll.longTasks,
      scrollRange: scroll.max,
      jumpMs: jump.ms,
      jumpLongTaskMaxMs: jump.longTaskMaxMs,
      heapAfter: await heap(page),
    }
  } finally {
    await context.close()
  }
}

const round = (v) => (v == null ? null : Math.round(v * 10) / 10)
for (const spec of cases) {
  const runs = []
  let error = null
  for (let i = 0; i < RUNS; i++) {
    try {
      runs.push(await once(spec))
    } catch (err) {
      error = String(err && err.message ? err.message : err)
      break
    }
  }
  const pick = (key) => round(median(runs.map((r) => r[key])))
  const range = (key) => runs.map((r) => round(r[key]))
  const row = {
    stem: spec.stem,
    calls: spec.calls,
    cpu: spec.cpu,
    error,
    rows: runs[0]?.rows ?? null,
    laneBars: runs[0]?.laneBars ?? null,
    panelNodes: runs[0]?.panelNodes ?? null,
    nodesBefore: runs[0]?.nodesBefore ?? null,
    nodesAfter: runs[0]?.nodesAfter ?? null,
    openMs: pick('openMs'),
    openMsRuns: range('openMs'),
    buildMs: pick('buildMs'),
    openLongTasks: range('openLongTasks'),
    openLongTaskMaxMs: range('openLongTaskMaxMs'),
    p95FrameMs: pick('p95FrameMs'),
    longestFrameMs: range('longestFrameMs'),
    scrollLongTasks: range('scrollLongTasks'),
    jumpMs: pick('jumpMs'),
    jumpMsRuns: range('jumpMs'),
    jumpLongTaskMaxMs: range('jumpLongTaskMaxMs'),
    heapAfter: pick('heapAfter'),
  }
  results.push(row)
  console.log(JSON.stringify(row))
}

await browser.close()
writeResults('measure-timing.json', { chrome: version, measuredAt: new Date().toISOString(), results })
