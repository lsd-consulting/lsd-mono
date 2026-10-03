/**
 * Headless Chromium timings for wide participant counts.
 * Same machine approach as measure.mjs: Playwright Chromium, viewport 1440×900, file://.
 *
 * Usage: node measure-wide.mjs /path/to/docs/perf-samples
 */
import { chromium } from '../../modules/lsd-mono-core/report/node_modules/playwright/index.mjs'
import { writeFileSync, statSync } from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node measure-wide.mjs <samples-dir>')
  process.exit(1)
}

const pages = [
  { participants: 20, messages: 400 },
  { participants: 50, messages: 400 },
  { participants: 100, messages: 400 },
  { participants: 100, messages: 2000 },
].map((spec) => ({
  ...spec,
  file: `mono-p${spec.participants}-m${spec.messages}-diagram.html`,
}))

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
    const used = metrics.find((m) => m.name === 'JSHeapUsedSize')
    await session.detach()
    return used ? Math.round(used.value) : null
  } catch {
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
    } catch {
      window.__longTasks = null
    }
  })
  const row = {
    participants: spec.participants,
    messages: spec.messages,
    file: spec.file,
    htmlBytes: statSync(filePath).size,
    firstInteractiveMs: null,
    error: null,
  }
  try {
    const started = Date.now()
    await page.goto(url, { waitUntil: 'commit', timeout: 120000 })
    await page.waitForSelector('.seq-sticky-header', { state: 'visible', timeout: 120000 })
    row.firstInteractiveMs = Date.now() - started
    try {
      await page.waitForLoadState('load', { timeout: 15000 })
    } catch {
      row.loadWait = 'timeout'
    }
    const paints = await page.evaluate(() => {
      const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')
      return { fcp: fcp ? fcp.startTime : null }
    })
    row.fcpMs = paints.fcp == null ? null : Math.round(paints.fcp)
    row.heapAfterLoad = await heap(page)

    const layout = await page.evaluate(() => {
      const scroller = document.querySelector('.seq-scroll')
      const header = document.querySelector('.seq-sticky-header')
      if (!scroller || !header) return { error: 'missing diagram' }
      const style = getComputedStyle(scroller)
      const labels = [...document.querySelectorAll('.seq-sticky-header .participant-label')]
      const rects = labels.map((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, text: el.textContent || '' }
      })
      rects.sort((a, b) => a.left - b.left)
      let overlaps = 0
      const overlapPairs = []
      for (let i = 1; i < rects.length; i++) {
        if (rects[i].left < rects[i - 1].right - 1) {
          overlaps++
          if (overlapPairs.length < 5) overlapPairs.push([rects[i - 1].text, rects[i].text])
        }
      }
      const types = [...document.querySelectorAll('.participant-box')].map((el) => el.getAttribute('data-participant-type'))
      const typeCounts = {}
      for (const t of types) typeCounts[t || 'unknown'] = (typeCounts[t || 'unknown'] || 0) + 1
      const maxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
      const headerRectBefore = header.getBoundingClientRect()
      const firstBefore = labels[0] ? labels[0].getBoundingClientRect() : null
      scroller.scrollLeft = maxX
      const scrolled = scroller.scrollLeft
      const last = labels[labels.length - 1]
      const first = labels[0]
      const srect = scroller.getBoundingClientRect()
      const lastRect = last ? last.getBoundingClientRect() : null
      const firstRect = first ? first.getBoundingClientRect() : null
      const headerRectAfter = header.getBoundingClientRect()
      const lastInView = Boolean(
        lastRect && lastRect.right <= srect.right + 4 && lastRect.left < srect.right && lastRect.right > srect.left,
      )
      const firstOffLeft = Boolean(firstRect && firstRect.right < srect.left + 8)
      scroller.scrollLeft = 0
      const toggles = document.querySelector('.participant-toggles')
      return {
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        maxScrollLeft: maxX,
        scrolledLeft: Math.round(scrolled),
        horizontalScrollWorks: maxX > 8 ? scrolled > maxX * 0.9 : scrolled === 0,
        lastLabelInViewAtEnd: lastInView,
        firstLabelOffLeftAtEnd: firstOffLeft,
        headerShifted: Boolean(
          firstBefore && firstRect && Math.abs(firstRect.left - firstBefore.left) > 8,
        ),
        headerTop: Math.round(headerRectBefore.top),
        headerTopAfterHScroll: Math.round(headerRectAfter.top),
        labelCount: labels.length,
        labelOverlaps: overlaps,
        overlapPairs,
        participantBoxes: types.length,
        typeCounts,
        headerNodes: header.getElementsByTagName('*').length,
        nodes: document.getElementsByTagName('*').length,
        toggleHeight: toggles ? Math.round(toggles.getBoundingClientRect().height) : null,
        toggleScrollWidth: toggles ? toggles.scrollWidth : null,
        toggleClientWidth: toggles ? toggles.clientWidth : null,
      }
    })
    if (layout.error) throw new Error(layout.error)
    Object.assign(row, layout)

    const scroll = await page.evaluate(async () => {
      const scroller = document.querySelector('.seq-scroll')
      const frames = []
      let last = performance.now()
      const t0 = last
      const duration = 2000
      const maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const maxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
      await new Promise((resolve) => {
        const tick = (now) => {
          frames.push(now - last)
          last = now
          const p = Math.min(1, (now - t0) / duration)
          scroller.scrollTop = maxY * p
          scroller.scrollLeft = maxX * (p < 0.5 ? p * 2 : (1 - p) * 2)
          if (p >= 1) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      const header = document.querySelector('.seq-sticky-header')
      const srect = scroller.getBoundingClientRect()
      const hrect = header.getBoundingClientRect()
      scroller.scrollTop = maxY
      const hrectBottom = header.getBoundingClientRect()
      return {
        frames,
        longTasks: window.__longTasks,
        stickyWhileScrolled: Math.abs(hrectBottom.top - srect.top) < 3,
        headerTopDelta: Math.round((hrect.top - srect.top) * 10) / 10,
      }
    })
    row.frameCount = scroll.frames.length
    row.p95FrameMs = Math.round(percentile(scroll.frames, 95) * 10) / 10
    row.longestFrameMs = Math.round(Math.max(...scroll.frames) * 10) / 10
    row.stickyHeaderWhileVerticalScroll = scroll.stickyWhileScrolled
    row.longTaskCount = scroll.longTasks == null ? null : scroll.longTasks.filter((d) => d >= 50).length
    row.longTaskMaxMs = scroll.longTasks && scroll.longTasks.length
      ? Math.round(Math.max(...scroll.longTasks) * 10) / 10
      : scroll.longTasks == null ? null : 0
    row.heapAfterScroll = await heap(page)

    const zoomBefore = await page.locator('.zoom-readout').innerText()
    const fit0 = Date.now()
    await page.locator('[data-zoom="fit"]').click()
    await page.waitForFunction((prev) => {
      const el = document.querySelector('.zoom-readout')
      return el && el.textContent && el.textContent !== prev
    }, zoomBefore, { timeout: 5000 }).catch(() => null)
    row.fitMs = Date.now() - fit0
    await page.waitForFunction(() => {
      const scroller = document.querySelector('.seq-scroll')
      const btn = document.querySelector('button.msg-open[data-message-id="1"]')
      return Boolean(scroller && scroller.scrollTop === 0 && btn)
    }, null, { timeout: 5000 })
    await page.waitForTimeout(250)
    row.fitZoom = (await page.locator('.zoom-readout').innerText()).trim()
    row.fitTopLabel = await page.evaluate(() => {
      const scroller = document.querySelector('.seq-scroll')
      const header = document.querySelector('.seq-sticky-header')
      const label = document.querySelector('button.msg-open[data-message-id="1"]')
        ? document.querySelector('.seq-svg .msg-label')
        : null
      if (!scroller || !header || !label) return { shown: false, reason: 'missing label' }
      const maxLeft = scroller.scrollWidth - scroller.clientWidth
      const lr = label.getBoundingClientRect()
      const sr = scroller.getBoundingClientRect()
      const hr = header.getBoundingClientRect()
      const shown =
        lr.width > 0 &&
        lr.height > 0 &&
        lr.bottom > hr.bottom + 0.5 &&
        lr.top < sr.bottom - 0.5 &&
        lr.right > sr.left + 0.5 &&
        lr.left < sr.right - 0.5
      const fully =
        lr.top >= hr.bottom - 1 &&
        lr.bottom <= sr.bottom + 1 &&
        lr.left >= sr.left - 1 &&
        lr.right <= sr.right + 1
      return {
        shown,
        fully,
        text: (label.textContent || '').slice(0, 80),
        top: Math.round(lr.top),
        bottom: Math.round(lr.bottom),
        left: Math.round(lr.left),
        right: Math.round(lr.right),
        headerBottom: Math.round(hr.bottom),
        scrollerTop: Math.round(sr.top),
        scrollerBottom: Math.round(sr.bottom),
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        maxScrollLeft: maxLeft,
        scrollTop: scroller.scrollTop,
        scrollLeft: scroller.scrollLeft,
      }
    })

    await page.evaluate(() => {
      const scroller = document.querySelector('.seq-scroll')
      if (scroller) {
        scroller.scrollTop = 0
        scroller.scrollLeft = 0
      }
    })
    await page.locator('.zoom-readout').waitFor()
    const zoomNow = await page.locator('.zoom-readout').innerText()
    if (zoomNow.trim() !== '100%') {
      await page.locator('[data-zoom="in"]').click().catch(() => {})
    }
    // Fit may have changed zoom. Reset by clicking out/in is unreliable.
    // Reload is cleaner for the click measurement at 100%. The user asked for
    // one arrow click as part of the measurement, at the zoom the page opens with.
    await page.reload({ waitUntil: 'commit' })
    await page.waitForSelector('.seq-sticky-header', { state: 'visible', timeout: 120000 })
    await page.waitForSelector('button.msg-open[data-message-id="1"]', { timeout: 15000 })
    const button = page.locator('button.msg-open[data-message-id="1"]')
    await button.scrollIntoViewIfNeeded()
    const t0 = Date.now()
    await button.click()
    await page.waitForFunction(() => {
      const panel = document.querySelector('#inspector')
      const pre = document.querySelector('#inspector-pre')
      const text = pre ? pre.textContent || '' : ''
      const expanded = document.querySelector('#inspector-json')?.getAttribute('aria-expanded')
      return Boolean(panel && !panel.hidden && expanded === 'true' && text.includes('arrow-payload') && text.includes('"orderId": "ord_1"'))
    }, null, { timeout: 15000 })
    row.popupMs = Date.now() - t0
    row.popupLabel = await page.locator('#inspector-title').innerText()
    row.heapAfterPopup = await heap(page)
    row.nodesAfterPopup = await page.evaluate(() => document.getElementsByTagName('*').length)
    const tasks = await page.evaluate(() => window.__longTasks)
    row.longTaskCountAfterPopup = tasks == null ? null : tasks.filter((d) => d >= 50).length
    row.longTaskMaxAfterPopupMs = tasks && tasks.length ? Math.round(Math.max(...tasks) * 10) / 10 : tasks == null ? null : 0
    row.nodesAfterLoad = row.nodes
  } catch (err) {
    row.error = String(err && err.message ? err.message : err)
  }
  results.push(row)
  console.log(JSON.stringify(row))
  await context.close()
}

await browser.close()
const out = { chrome: version, measuredAt: new Date().toISOString(), viewport: '1440x900', results }
writeFileSync('/tmp/lsd-perf/measure-wide.json', JSON.stringify(out, null, 2))
console.log('WROTE /tmp/lsd-perf/measure-wide.json chrome', version)
