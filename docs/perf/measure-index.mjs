import { chromium } from '../../modules/lsd-mono-core/report/node_modules/playwright/index.mjs'
import { resolve } from 'node:path'
// Usage: node docs/perf/measure-index.mjs <report directory with index.html>
const url = 'file://' + resolve(process.argv[2], 'index.html')
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const b = await chromium.launch()
const first = [], heap0 = [], sw = [], heap1 = [], navItems = []
for (let run = 0; run < 5; run++) {
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await c.newPage()
  const cdp = await c.newCDPSession(p); await cdp.send('Performance.enable')
  const errs = []; p.on('pageerror', (e) => errs.push(e.message))
  const t0 = Date.now(); await p.goto(url); await p.locator('.seq-svg').first().waitFor()
  first.push(Date.now() - t0)
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const m = (await cdp.send('Performance.getMetrics')).metrics; return m.find((x) => x.name === 'JSHeapUsedSize').value / 1048576 }
  heap0.push(await heap())
  navItems.push(await p.locator('#scenario-nav li').count())
  const ids = await p.evaluate(() => window.__LSD_INDEX__.reports.map((r) => r.id))
  for (let k = 1; k <= 20; k++) {
    const id = ids[(k * 37) % ids.length]
    const n = ids.indexOf(id) + 1
    const t = Date.now()
    await p.evaluate((h) => { location.hash = h }, `#report=${id}`)
    await p.locator('.hero-index', { hasText: `report ${n} of ${ids.length}` }).waitFor()
    await p.locator('.seq-svg').first().waitFor()
    sw.push(Date.now() - t)
  }
  heap1.push(await heap())
  if (errs.length) console.log('errors', errs)
  await c.close()
}
console.log(JSON.stringify({ firstViewMs: { median: med(first), all: first }, heapAfterLoadMB: med(heap0).toFixed(1), heapAfter20SwitchesMB: med(heap1).toFixed(1), switchMs: { median: med(sw), p90: [...sw].sort((x, y) => x - y)[Math.floor(sw.length * 0.9)], max: Math.max(...sw) }, navItems: navItems[0] }))
await b.close()
