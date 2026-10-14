/**
 * Headless Chromium timings for the large-diagram check.
 * Usage: node measure.mjs /path/to/docs/perf-samples
 */
import { chromium } from '../../modules/lsd-mono-core/report/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node measure.mjs <samples-dir>')
  process.exit(1)
}

const pages = []
for (const size of [100, 500, 2000]) {
  pages.push({
    size,
    side: 'mono',
    file: `mono-${size}-diagram.html`,
    selector: '.seq-sticky-header',
    scroller: '.seq-scroll',
    interact: true,
  })
  pages.push({
    size,
    side: 'legacy-split-50',
    file: `legacy-split-50-${size}.html`,
    selector: 'section.sequence svg',
    scroller: null,
    interact: false,
  })
  pages.push({
    size,
    side: 'legacy-one-svg',
    file: `legacy-one-svg-${size}.html`,
    selector: 'section.sequence svg',
    scroller: null,
    interact: false,
  })
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

async function heap(page) {
  try {
    const session = await page.context().newCDPSession(page)
    await session.send('Performance.enable')
    const { metrics } = await session.send('Performance.getMetrics')
    const heap = metrics.find((m) => m.name === 'JSHeapUsedSize')
    await session.detach()
    return heap ? Math.round(heap.value) : null
  } catch (err) {
    return null
  }
}

const browser = await chromium.launch({ headless: true })
const version = browser.version()
const results = []

for (const spec of pages) {
  const filePath = path.resolve(dir, spec.file)
  const url = 'file://' + filePath
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.__longTasks = []
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks.push(entry.duration)
      }).observe({ type: 'longtask', buffered: true })
    } catch (err) {
      window.__longTasks = null
    }
  })
  const row = {
    size: spec.size,
    side: spec.side,
    file: spec.file,
    firstInteractiveMs: null,
    fcpMs: null,
    p95FrameMs: null,
    longestFrameMs: null,
    frameCount: null,
    longTaskCount: null,
    longTaskMaxMs: null,
    heapAfterLoad: null,
    heapAfterScroll: null,
    searchMs: null,
    zoomMs: null,
    matchVisible: null,
    headerVisible: null,
    popupFirstMs: null,
    popupMidMs: null,
    popupMidLabel: null,
    heapAfterPopup: null,
    nodesAfterPopup: null,
    error: null,
  }
  try {
    const started = Date.now()
    await page.goto(url, { waitUntil: 'commit', timeout: 120000 })
    await page.waitForSelector(spec.selector, { state: 'visible', timeout: 120000 })
    row.firstInteractiveMs = Date.now() - started
    row.headerVisible = spec.side === 'mono'
      ? await page.locator('.seq-sticky-header').isVisible()
      : await page.locator(spec.selector).first().isVisible()
    try {
      await page.waitForLoadState('load', { timeout: 15000 })
    } catch (err) {
      row.loadWait = 'timeout'
    }
    const paints = await page.evaluate(() => {
      const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')
      const nav = performance.getEntriesByType('navigation')[0]
      return {
        fcp: fcp ? fcp.startTime : null,
        load: nav ? nav.loadEventEnd : null,
        dcl: nav ? nav.domContentLoadedEventEnd : null,
      }
    })
    row.fcpMs = paints.fcp == null ? null : Math.round(paints.fcp)
    row.loadEventEndMs = paints.load == null ? null : Math.round(paints.load)
    row.domContentLoadedMs = paints.dcl == null ? null : Math.round(paints.dcl)
    row.heapAfterLoad = await heap(page)
    row.nodes = await page.evaluate(() => document.getElementsByTagName('*').length)

    const scroll = await page.evaluate(async (sel) => {
      const scroller = sel ? document.querySelector(sel) : document.scrollingElement
      if (!scroller) return { error: 'no scroller' }
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const frames = []
      let last = performance.now()
      const t0 = last
      const duration = 2000
      await new Promise((resolve) => {
        const tick = (now) => {
          frames.push(now - last)
          last = now
          const p = Math.min(1, (now - t0) / duration)
          scroller.scrollTop = max * p
          if (p >= 1) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      const longTasks = window.__longTasks
      return {
        frames,
        max,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        longTasks,
      }
    }, spec.scroller)
    if (scroll.error) throw new Error(scroll.error)
    row.frameCount = scroll.frames.length
    row.p95FrameMs = Math.round(percentile(scroll.frames, 95) * 10) / 10
    row.longestFrameMs = Math.round(Math.max(...scroll.frames) * 10) / 10
    row.scrollHeight = scroll.scrollHeight
    row.longTaskCount = scroll.longTasks == null ? null : scroll.longTasks.filter((d) => d >= 50).length
    row.longTaskMaxMs = scroll.longTasks && scroll.longTasks.length
      ? Math.round(Math.max(...scroll.longTasks) * 10) / 10
      : scroll.longTasks == null ? null : 0
    row.heapAfterScroll = await heap(page)

    if (spec.interact) {
      const before = await page.locator('.zoom-readout').innerText()
      const z0 = Date.now()
      await page.locator('[data-zoom="in"]').click()
      await page.waitForFunction((prev) => {
        const el = document.querySelector('.zoom-readout')
        return el && el.textContent && el.textContent !== prev
      }, before, { timeout: 5000 })
      row.zoomMs = Date.now() - z0

      const needle = `needle-${spec.size}`
      const s0 = Date.now()
      await page.locator('[data-diagram-find]').fill(needle)
      await page.waitForFunction(() => {
        const el = document.querySelector('.diagram-find-count')
        return el && /1 match/.test(el.textContent || '')
      }, null, { timeout: 5000 })
      row.searchMs = Date.now() - s0
      await page.evaluate(() => {
        const scroller = document.querySelector('.seq-scroll')
        if (scroller) scroller.scrollTop = scroller.scrollHeight
      })
      const match = page.locator('.note-match-cue', { hasText: '[match]' })
      try {
        await match.first().waitFor({ state: 'attached', timeout: 5000 })
        row.matchVisible = true
      } catch {
        row.matchVisible = false
      }

      // A tall diagram scrolls with the page: the page owns the vertical scroll and
      // the diagram follows it. Closing the inspector returns focus to the arrow it
      // came from, which can scroll the page back, so retry until the row is painted.
      async function scrollUntil(messageId) {
        const painted = (id) => page.evaluate((id) => {
          return [...document.querySelectorAll('button.msg-open')].some((b) => b.getAttribute('data-message-id') === id)
        }, id)
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          await page.evaluate(({ id, size }) => {
            const stage = document.querySelector('.seq-stage')
            if (!stage) return
            const top = stage.getBoundingClientRect().top + window.scrollY
            const range = Math.max(0, stage.offsetHeight - window.innerHeight)
            const target = Number(id)
            const frac = target <= 1 ? 0 : Math.min(0.92, Math.max(0, (target - 8) / size))
            window.scrollTo({ top: top + range * frac, behavior: 'instant' })
          }, { id: messageId, size: spec.size })
          await page.waitForTimeout(100)
          if (await painted(messageId)) return
        }
        const state = await page.evaluate(() => {
          const ids = [...document.querySelectorAll('button.msg-open')].map((b) => Number(b.getAttribute('data-message-id')))
          return { pageY: scrollY, first: Math.min(...ids), last: Math.max(...ids) }
        })
        throw new Error(`message ${messageId} not painted: ${JSON.stringify(state)}`)
      }

      async function openArrow(messageId) {
        await page.evaluate(() => {
          const panel = document.querySelector('#inspector')
          const close = document.querySelector('#inspector-close')
          if (panel && !panel.hidden && close) close.click()
        })
        await scrollUntil(messageId)
        const button = page.locator(`button.msg-open[data-message-id="${messageId}"]`)
        const count = await page.locator('button.msg-open').count()
        const label = await button.getAttribute('aria-label')
        const t0 = Date.now()
        await button.click()
        // The inspector expands the JSON by itself once the payload loads. Clicking
        // the toggle here would collapse it, so wait for the expanded state instead.
        await page.waitForFunction((id) => {
          const panel = document.querySelector('#inspector')
          const pre = document.querySelector('#inspector-pre')
          const text = pre ? pre.textContent || '' : ''
          const expanded = document.querySelector('#inspector-json')?.getAttribute('aria-expanded')
          return Boolean(panel && !panel.hidden && expanded === 'true' && text.includes('arrow-payload') && text.includes('"orderId": "ord_' + id + '"'))
        }, messageId, { timeout: 5000 })
        return { ms: Date.now() - t0, label, messageId, count }
      }

      const first = await openArrow('1')
      row.popupFirstMs = first.ms
      row.popupFirstLabel = first.label
      row.popupFirstMessageId = first.messageId

      const midId = String(Math.round(spec.size / 2))
      const mid = await openArrow(midId)
      row.popupMidMs = mid.ms
      row.popupMidLabel = mid.label
      row.popupMidMessageId = mid.messageId
      row.popupButtonsInView = mid.count
      row.heapAfterPopup = await heap(page)
      row.nodesAfterPopup = await page.evaluate(() => document.getElementsByTagName('*').length)
      const tasks = await page.evaluate(() => window.__longTasks)
      row.longTaskCountAfterPopup = tasks == null ? null : tasks.filter((d) => d >= 50).length
      row.longTaskMaxAfterPopupMs = tasks && tasks.length ? Math.round(Math.max(...tasks) * 10) / 10 : tasks == null ? null : 0
    }
  } catch (err) {
    row.error = String(err && err.message ? err.message : err)
  }
  results.push(row)
  console.log(JSON.stringify(row))
  await context.close()
}

await browser.close()
const out = { chrome: version, measuredAt: new Date().toISOString(), results }
writeFileSync('/tmp/lsd-perf/measure.json', JSON.stringify(out, null, 2))
console.log('WROTE /tmp/lsd-perf/measure.json chrome', version)
