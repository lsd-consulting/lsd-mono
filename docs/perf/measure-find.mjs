/**
 * Headless Chromium timings for Find over message payloads (#60): the first search, each
 * keystroke after it, the longest main-thread task while it runs, the index's memory, and the
 * side panel's marks. Same approach as measure.mjs: Playwright Chromium, viewport 1440×900, file://.
 *
 * Each run opens the page twice. Cold: the first key in Find, which loads the payload script,
 * indexes it in slices and searches it, timed in the page from the key to the final count. Then
 * warm: the payload script is loaded by hand, so the payloads' heap and the index's heap can be
 * told apart, and the keys after the first are timed. A `scale` above 1 repeats every payload
 * that many times as it loads, for the 10× stress rows.
 *
 * Usage: node measure-find.mjs /path/to/docs/perf-samples
 */
import { chromium } from '../../modules/lsd-mono-core/report/node_modules/playwright/index.mjs'
import { statSync } from 'node:fs'
import path from 'node:path'
import { heap, percentile, recordLongTasks, writeResults } from './perf-kit.mjs'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node measure-find.mjs <samples-dir>')
  process.exit(1)
}

const only = process.argv[3]
const all = [
  { stem: 'mono-2000', cpu: 1, scale: 1 },
  { stem: 'mono-2000', cpu: 6, scale: 1 },
  { stem: 'mono-p100-m2000', cpu: 1, scale: 1 },
  { stem: 'mono-p100-m2000', cpu: 6, scale: 1 },
  { stem: 'mono-p100-m2000', cpu: 1, scale: 10 },
  { stem: 'mono-p100-m2000', cpu: 4, scale: 10 },
]
// A second argument, such as "mono-p100-m2000:1:10", runs that case alone.
const cases = only ? all.filter((c) => `${c.stem}:${c.cpu}:${c.scale}` === only) : all
// Typed one key at a time: each refines the last (only the previous hits are searched), then
// two Backspaces (a full search each) and a fresh word that matches nothing.
const KEYS = ['s', 'so', 'soc', 'sock', 'sock-', 'sock-1', 'sock-19', 'sock-199', 'sock-19', 'sock-1', 'zzzz']
const RUNS = 3

const browser = await chromium.launch({ headless: true })
const version = browser.version()
const results = []

async function gcHeap(page) {
  const session = await page.context().newCDPSession(page)
  await session.send('HeapProfiler.collectGarbage')
  await session.detach()
  return heap(page)
}

/** In the page: run [step], then wait until Find's count no longer says it is searching. */
function pageHelpers() {
  window.__gaps = []
  let last = performance.now()
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    const now = performance.now()
    window.__gaps.push(now - last)
    last = now
    if (window.__probe) channel.port2.postMessage(0)
  }
  window.__probeStart = () => {
    window.__gaps = []
    window.__probe = true
    last = performance.now()
    channel.port2.postMessage(0)
  }
  window.__probeStop = () => {
    window.__probe = false
    return Math.max(0, ...window.__gaps)
  }
  window.__settled = () =>
    new Promise((resolve) => {
      const count = document.querySelector('.diagram-find-count')
      const done = () => !/searching/i.test(count.textContent)
      if (done()) return resolve()
      const observer = new MutationObserver(() => {
        if (done()) {
          observer.disconnect()
          resolve()
        }
      })
      observer.observe(count, { childList: true, subtree: true, characterData: true })
    })
  window.__type = async (value) => {
    const input = document.querySelector('[data-diagram-find]')
    const t0 = performance.now()
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const syncMs = performance.now() - t0
    await window.__settled()
    return { syncMs, answerMs: performance.now() - t0, count: document.querySelector('.diagram-find-count').textContent }
  }
}

/** A fresh page on [spec]'s diagram, CPU throttled, with the helpers above. */
async function openPage(spec) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await recordLongTasks(page)
  await page.addInitScript(() => {
    // When the payload script has run: its parse is the first part of a cold search.
    let held
    Object.defineProperty(window, '__LSD_PAYLOADS__', {
      configurable: true,
      get: () => held,
      set: (map) => {
        if (map && !window.__parsedAt) window.__parsedAt = performance.now()
        held = map
      },
    })
  })
  if (spec.scale > 1) {
    await page.addInitScript((scale) => {
      const timed = Object.getOwnPropertyDescriptor(window, '__LSD_PAYLOADS__')
      Object.defineProperty(window, '__LSD_PAYLOADS__', {
        configurable: true,
        get: timed.get,
        set: (map) => {
          if (map) for (const k of Object.keys(map)) map[k] = Array.from({ length: scale }, (_, i) => ({ copy: i, ...map[k] }))
          timed.set(map)
        },
      })
    }, spec.scale)
  }
  await page.goto('file://' + path.resolve(dir, `${spec.stem}-diagram.html`))
  await page.locator('.seq-svg').waitFor()
  await page.waitForTimeout(400)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: spec.cpu })
  await page.evaluate(pageHelpers)
  return { context, page }
}

for (const spec of cases) {
  for (let run = 0; run < RUNS; run++) {
    const coldPage = await openPage(spec)
    const cold = await coldPage.page.evaluate(async () => {
      const input = document.querySelector('[data-diagram-find]')
      const t0 = performance.now()
      window.__probeStart()
      input.focus()
      const answer = await window.__type('sock-1')
      const maxTaskMs = window.__probeStop()
      return { ...answer, answerMs: performance.now() - t0, parseMs: window.__parsedAt - t0, maxTaskMs }
    })
    const coldLongTasks = await coldPage.page.evaluate(() => (window.__longTasks ?? []).filter((d) => d >= 50).length)
    await coldPage.context.close()

    const { context, page } = await openPage(spec)

    const heapBefore = await gcHeap(page)
    const loadMs = await page.evaluate(async (src) => {
      const t0 = performance.now()
      await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = src
        script.onload = resolve
        script.onerror = reject
        document.head.append(script)
      })
      return performance.now() - t0
    }, `${spec.stem}-payloads.js`)
    const heapLoaded = await gcHeap(page)

    await page.evaluate(() => {
      window.__longTasks && (window.__longTasks.length = 0)
      document.querySelector('[data-diagram-find]').focus()
      window.__probeStart()
    })
    const first = await page.evaluate(() => window.__type('sock-1'))
    const firstMaxTaskMs = await page.evaluate(() => window.__probeStop())
    const heapIndexed = await gcHeap(page)
    const chars = await page.evaluate(() =>
      Object.values(window.__LSD_PAYLOADS__).reduce((sum, p) => sum + JSON.stringify(p, null, 2).length, 0),
    )

    await page.evaluate(() => window.__type(''))
    await page.evaluate(() => window.__probeStart())
    const keys = []
    for (const value of KEYS) keys.push({ value, ...(await page.evaluate((v) => window.__type(v), value)) })
    const typingMaxTaskMs = await page.evaluate(() => window.__probeStop())
    const longTasks = await page.evaluate(() => (window.__longTasks ?? []).filter((d) => d >= 50).length)

    // The same keys with the side panel open on the first arrow: what marking its payload adds.
    await page.evaluate(() => window.__type(''))
    await page.locator('.msg-open').first().click()
    await page.locator('#inspector-pre').filter({ hasText: 'arrow-payload' }).waitFor()
    const panelKeys = []
    for (const value of ['e', 'zzzz', 'e']) panelKeys.push(await page.evaluate((v) => window.__type(v), value))
    const panelMarks = await page.locator('#inspector-pre mark.json-hit').count()
    await page.keyboard.press('Escape')
    await page.locator('#inspector-pre').waitFor({ state: 'hidden' }).catch(() => undefined)
    const closedKeys = []
    for (const value of ['', 'e', 'zzzz', 'e']) closedKeys.push(await page.evaluate((v) => window.__type(v), value))

    // The side panel: one payload with more matches than the mark cap, against the same payload with no query.
    let marks = null
    if (run === 0) {
      const open = async (query) => {
        await page.evaluate((q) => window.__type(q), query)
        await page.keyboard.press('Escape').catch(() => undefined)
        const arrow = page.locator('.msg-open').first()
        const t0 = await page.evaluate(() => performance.now())
        await arrow.click()
        await page.locator('#inspector-pre').filter({ hasText: 'arrow-payload' }).waitFor()
        if (query) await page.locator('#inspector-pre mark.json-hit').first().waitFor()
        const ms = (await page.evaluate(() => performance.now())) - t0
        const n = await page.locator('#inspector-pre mark.json-hit').count()
        await page.keyboard.press('Escape')
        await page.locator('#inspector-pre').waitFor({ state: 'hidden' }).catch(() => undefined)
        return { ms, marks: n }
      }
      const plain = await open('')
      const marked = await open('e')
      marks = { plainOpenMs: Math.round(plain.ms), markedOpenMs: Math.round(marked.ms), marks: marked.marks }
    }

    // The same keys with payloads turned out of Find: what Find costs without them.
    await page.evaluate(() => window.__type(''))
    await page.locator('[data-find-payloads]').click()
    const offKeys = []
    for (const value of KEYS) offKeys.push(await page.evaluate((v) => window.__type(v), value))

    const answers = keys.map((k) => k.answerMs)
    results.push({
      ...spec,
      run,
      payloadFileBytes: statSync(path.resolve(dir, `${spec.stem}-payloads.js`)).size * spec.scale,
      payloadChars: chars,
      coldFirstSearchMs: +cold.answerMs.toFixed(1),
      coldParsedAtMs: +cold.parseMs.toFixed(1),
      coldMaxTaskMs: +cold.maxTaskMs.toFixed(1),
      coldLongTasksOver50: coldLongTasks,
      coldCount: cold.count,
      loadParseMs: +loadMs.toFixed(1),
      firstSearchMs: +first.answerMs.toFixed(1),
      firstSearchSyncMs: +first.syncMs.toFixed(1),
      firstMaxTaskMs: +firstMaxTaskMs.toFixed(1),
      firstCount: first.count,
      keyMedianMs: +percentile(answers, 50).toFixed(1),
      keyMaxMs: +Math.max(...answers).toFixed(1),
      keySyncMaxMs: +Math.max(...keys.map((k) => k.syncMs)).toFixed(1),
      typingMaxTaskMs: +typingMaxTaskMs.toFixed(1),
      longTasksOver50: longTasks,
      payloadHeapMB: +((heapLoaded - heapBefore) / 1e6).toFixed(1),
      indexHeapMB: +((heapIndexed - heapLoaded) / 1e6).toFixed(1),
      keys: keys.map((k) => `${k.value}: ${k.answerMs.toFixed(1)} ms (${k.count})`),
      marks,
      // Key 'e' (third) and its repeat, panel open against closed: the marks' share of the keystroke.
      panelMarks,
      panelKeySyncMs: +Math.max(panelKeys[0].syncMs, panelKeys[2].syncMs).toFixed(1),
      panelNoMatchSyncMs: +panelKeys[1].syncMs.toFixed(1),
      closedKeySyncMs: +Math.max(closedKeys[1].syncMs, closedKeys[3].syncMs).toFixed(1),
      offKeyMedianMs: +percentile(offKeys.map((k) => k.answerMs), 50).toFixed(1),
      offKeySyncMaxMs: +Math.max(...offKeys.map((k) => k.syncMs)).toFixed(1),
    })
    console.log(JSON.stringify(results.at(-1)))
    await context.close()
  }
}

await browser.close()
writeResults('find.json', { chrome: version, results })
