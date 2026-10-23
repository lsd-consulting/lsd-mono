/**
 * The README images, taken from the report shell with headless Chromium (the Playwright check:ux
 * uses). GIFs are encoded in-process: Playwright's ffmpeg build cannot write GIF.
 *
 * Usage:
 *   node scripts/readme-samples.mjs diagram <report-dir> <out.png>   a module README's diagram
 *   node scripts/readme-samples.mjs tour <report-dir> <out.gif>      the root README's feature tour
 *
 * <report-dir> holds the one *-diagram.html its capture task wrote.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { encodeTour } from './readme/gif.mjs'
import { serve } from './readme/static-server.mjs'

const [mode, reportArg, outArg] = process.argv.slice(2)
if (!['diagram', 'tour'].includes(mode) || !reportArg || !outArg) {
  console.error('usage: node scripts/readme-samples.mjs diagram|tour <report-dir> <out-file>')
  process.exit(1)
}
const reportDir = path.resolve(reportArg)
const outFile = path.resolve(outArg)

/**
 * feature-tour.gif: one pass around a small shop report, with a drawn pointer, a click ring,
 * and a caption per beat. Frames are full viewport shots at 1:1, so this is also the GIF size.
 */
const TOUR_W = 1360
const TOUR_H = 800

/** Open the report in [dir] in a fresh context, run [use] on the page, then close everything. */
async function withReportPage(browser, dir, contextOptions, storage, use) {
  const diagrams = readdirSync(dir).filter((name) => name.endsWith('-diagram.html'))
  if (diagrams.length !== 1) {
    throw new Error(`expected one *-diagram.html in ${dir}, found ${diagrams.join(', ') || 'none'}`)
  }
  const server = await serve(dir)
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce', ...contextOptions })
  try {
    const page = await context.newPage()
    await page.addInitScript((items) => {
      for (const [store, key, value] of items) {
        const target = store === 'session' ? sessionStorage : localStorage
        if (value == null) target.removeItem(key)
        else target.setItem(key, value)
      }
    }, storage)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(diagrams[0])}`, { waitUntil: 'load' })
    await page.locator('.seq-svg').first().waitFor()
    await page.locator('.msg-label').first().waitFor()
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 4000))]))
    await use(page)
  } finally {
    await context.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function recordTour(page, file) {
  // Overlays: headless Chromium paints no cursor, so the pointer, click ring and caption are drawn.
  await page.addStyleTag({
    content: `
      #tour-pointer{position:fixed;left:0;top:0;width:26px;height:26px;z-index:10002;pointer-events:none;transform:translate(-3px,-2px)}
      #tour-ring{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #f97316;background:rgba(249,115,22,.22);z-index:10001;pointer-events:none;display:none}
      #tour-caption{position:fixed;left:24px;bottom:22px;z-index:10000;pointer-events:none;
        background:rgba(15,23,42,.92);color:#fff;font:600 19px/1.3 Inter,system-ui,sans-serif;padding:10px 20px;border-radius:12px;
        box-shadow:0 6px 24px rgba(0,0,0,.25);white-space:nowrap}
      #tour-caption:empty{display:none}
      #tour-step{display:inline-block;min-width:26px;margin-right:10px;padding:1px 8px;border-radius:999px;background:#f97316;color:#fff;font-size:15px;text-align:center}
    `,
  })
  await page.evaluate(() => {
    const pointer = document.createElement('div')
    pointer.id = 'tour-pointer'
    pointer.innerHTML =
      '<svg viewBox="0 0 22 22" width="26" height="26"><path d="M2 2 L2 18 L7 13.5 L10.5 20.5 L13.5 19 L10 12 L16.5 12 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    const ring = document.createElement('div')
    ring.id = 'tour-ring'
    const caption = document.createElement('div')
    caption.id = 'tour-caption'
    document.documentElement.append(ring, pointer, caption)
  })

  const frames = []
  let at = { x: TOUR_W * 0.55, y: TOUR_H * 0.45 }
  /** Add a frame shown for `delay` ms. An unchanged picture only lengthens the last frame. */
  async function snap(delay) {
    const png = await page.screenshot({ animations: 'disabled', caret: 'hide', type: 'png' })
    const last = frames[frames.length - 1]
    if (last && last.png.equals(png)) {
      last.delay += delay
      return
    }
    frames.push({ png, delay })
  }
  const total = () => frames.reduce((sum, frame) => sum + frame.delay, 0)
  async function placePointer(x, y) {
    at = { x, y }
    await page.evaluate(
      ([px, py]) => {
        const pointer = document.querySelector('#tour-pointer')
        pointer.style.left = `${px}px`
        pointer.style.top = `${py}px`
      },
      [x, y],
    )
  }
  async function moveTo(x, y, steps = 7) {
    const from = at
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      await placePointer(from.x + (x - from.x) * ease, from.y + (y - from.y) * ease)
      await snap(45)
    }
  }
  async function centre(locator) {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (!box) throw new Error('feature tour target has no box')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  async function ring(show) {
    await page.evaluate(
      ([visible, px, py]) => {
        const el = document.querySelector('#tour-ring')
        el.style.display = visible ? 'block' : 'none'
        el.style.left = `${px}px`
        el.style.top = `${py}px`
      },
      [show, at.x, at.y],
    )
  }
  /** Point at a control, show the click ring, then really click it. */
  async function click(locator, { hold = 500, settle } = {}) {
    const target = await centre(locator)
    await moveTo(target.x, target.y)
    await ring(true)
    await snap(140)
    await locator.click()
    if (settle) await settle()
    await page.waitForTimeout(120)
    await snap(160)
    await ring(false)
    await snap(hold)
  }
  let beat = 0
  async function caption(text, { sameBeat = false } = {}) {
    if (!sameBeat) beat++
    await page.evaluate(
      ([n, words]) => {
        const el = document.querySelector('#tour-caption')
        el.innerHTML = ''
        if (!words) return
        const step = document.createElement('span')
        step.id = 'tour-step'
        step.textContent = String(n)
        el.append(step, document.createTextNode(words))
      },
      [beat, text],
    )
  }

  const diagram = page.locator('.seq-diagram').first()
  const scroll = diagram.locator('.seq-scroll')
  const button = (name, exact = false) => diagram.getByRole('button', { name, exact })

  // 1. Overview: the list down the side, one scenario at a time (the first one first).
  await placePointer(at.x, at.y)
  await caption('Every scenario in the list; the first one opens first')
  await snap(700)
  await moveTo(130, 330, 6)
  await snap(500)
  await caption('Choose a scenario to see it on its own', { sameBeat: true })
  await click(page.locator('#scenario-nav [data-nav]').filter({ hasText: 'Shipping update' }), {
    hold: 900,
    settle: () => page.locator('.scenario-card h2', { hasText: 'Shipping update' }).waitFor(),
  })
  await click(page.locator('#scenario-nav [data-nav]').filter({ hasText: 'Place an order and pay by card' }), {
    hold: 600,
    settle: () => page.locator('.scenario-card h2', { hasText: 'Place an order and pay by card' }).waitFor(),
  })

  // 2. Zoom.
  await caption('Zoom in and out, then back to the default view')
  await page.evaluate(() => {
    const toolbar = document.querySelector('.seq-diagram .seq-toolbar')
    const top = toolbar.getBoundingClientRect().top + window.scrollY - 70
    window.scrollTo(0, Math.max(0, top))
  })
  await placePointer(at.x, Math.min(at.y, 300))
  await snap(500)
  await click(button('Zoom in'), { hold: 300 })
  await click(button('Zoom in'), { hold: 400 })
  await click(button('Zoom out'), { hold: 300 })
  await click(diagram.getByRole('button', { name: /^Reset zoom/ }), { hold: 800 })

  // 3. Find.
  await caption('Find messages and notes in the diagram')
  const find = diagram.locator('[data-diagram-find]')
  await click(find, { hold: 200 })
  for (const chunk of ['au', 'th', 'or', 'ise']) {
    await page.keyboard.type(chunk)
    await page.waitForTimeout(150)
    await snap(130)
  }
  await snap(500)
  // Scroll the diagram down to the match, a step at a time.
  const arrow = page.getByRole('button', { name: 'Open authorise £24.00' })
  for (let i = 0; i < 16; i++) {
    const view = await scroll.boundingBox()
    const hit = (await arrow.count()) ? await arrow.boundingBox() : null
    if (view && hit && hit.y > view.y + 90 && hit.y + hit.height < view.y + view.height * 0.7) break
    await scroll.evaluate((el) => {
      el.scrollTop += 70
    })
    await page.waitForTimeout(60)
    await snap(60)
  }
  await snap(900)

  // 4. Open an arrow's JSON, then drag the panel wider.
  await caption('Click an arrow to open its JSON, and drag the panel wider')
  await click(arrow, {
    hold: 900,
    settle: () => page.locator('#inspector-pre').waitFor({ state: 'visible' }),
  })
  const handle = page.locator('#inspector-resize')
  const grip = await handle.boundingBox()
  if (!grip) throw new Error('inspector resize handle has no box')
  const gx = grip.x + grip.width / 2
  const gy = grip.y + Math.min(260, grip.height / 2)
  await moveTo(gx, gy)
  await page.mouse.move(gx, gy)
  await page.mouse.down()
  await ring(true)
  await snap(120)
  for (let i = 1; i <= 6; i++) {
    const x = gx - (220 * i) / 6
    await page.mouse.move(x, gy)
    await placePointer(x, gy)
    await ring(true)
    await snap(70)
  }
  await page.mouse.up()
  await ring(false)
  await snap(800)

  // 5. The Components view, and a link's messages in the side panel (#105).
  await caption('See the scenario as a component diagram')
  // The diagram's heading just under the top bar, so the drawing has the screen.
  await page.evaluate(() => {
    const heading = document.querySelector('.diagram-heading').getBoundingClientRect()
    const bar = document.querySelector('.topbar').getBoundingClientRect().bottom
    window.scrollBy(0, heading.top - bar - 8)
  })
  await click(page.getByRole('tab', { name: 'Components' }), {
    hold: 900,
    settle: () => page.locator('.comp-scroll svg.component-diagram').waitFor(),
  })
  const link = page.locator('.comp-scroll').getByRole('button', { name: 'Orders to Orders DB, 3 interactions' })
  await caption('Click a link to list the messages behind it', { sameBeat: true })
  const linkBox = await link.locator('.edge-badge').boundingBox()
  if (linkBox) {
    await moveTo(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2)
    await ring(true)
    await snap(140)
    await link.focus()
    await page.keyboard.press('Enter')
    await page.locator('#inspector-link .component-links').waitFor()
    await page.evaluate(() => document.activeElement?.blur())
    await snap(160)
    await ring(false)
    const listed = await page.locator('#inspector-link .component-links').boundingBox()
    if (listed) await moveTo(listed.x + 60, listed.y + 10, 5)
    await snap(1100)
  }
  await page.locator('#inspector-close').click()
  await page.locator('#inspector').waitFor({ state: 'hidden' })
  await click(page.getByRole('tab', { name: 'Sequence' }), {
    hold: 300,
    settle: () => page.locator('.diagram-pane[data-pane="sequence"]:not([hidden])').waitFor(),
  })

  // 6. Timing: the summary strip opens swim lanes and the waterfall.
  await caption('Timing: summary strip, swim lanes and a waterfall')
  await page.evaluate(() => window.scrollTo(0, 0))
  await click(page.locator('.timing-strip .timing-chip').first(), {
    hold: 900,
    settle: () => page.locator('#inspector-metrics .swim-lanes').waitFor({ state: 'visible' }),
  })
  await caption('Clock-ordered events carry a clock badge', { sameBeat: true })
  await page
    .locator('#inspector-metrics .waterfall .wf-row.clock')
    .first()
    .evaluate((el) => {
      el.scrollIntoView({ block: 'center' })
    })
  const clocked = await page.locator('#inspector-metrics .waterfall .wf-row.clock').first().boundingBox()
  if (clocked) await moveTo(clocked.x + 80, clocked.y + clocked.height / 2, 5)
  await snap(900)
  await page.locator('#inspector-close').click()
  await page.locator('#inspector').waitFor({ state: 'hidden' })

  await find.fill('')
  await page.waitForTimeout(150)

  // 7. Hide a participant.
  await caption('Hover a participant and press × to hide it')
  // One set of Hide and More buttons moves onto the header in use (#62), so hover the header first.
  const head = diagram.locator('[data-participant-head][data-name="Order events"]')
  const headAt = await centre(head)
  await moveTo(headAt.x, headAt.y)
  await page.mouse.move(headAt.x, headAt.y)
  const hideX = button('Hide Order events', true)
  await hideX.waitFor()
  await snap(700)
  await click(hideX, { hold: 900 })
  // The chip lists what is hidden, with Show and Show all.
  await click(diagram.locator('.hidden-chip'), { hold: 1100 })
  await page.keyboard.press('Escape')
  await snap(200)

  // 8. Themes: light, dark, high contrast, then Auto (follows the OS, light here).
  await caption('Light, dark and high-contrast themes, or Auto to follow the OS')
  await page.evaluate(() => window.scrollTo(0, 0))
  await snap(200)
  // The theme menu: dark, high contrast, then Auto.
  for (const [mode, shown, hold] of [
    ['dark', 'dark', 800],
    ['contrast', 'contrast', 700],
    ['auto', 'light', 900],
  ]) {
    await click(page.locator('#btn-theme'), { hold: 200 })
    await click(page.locator(`#theme-menu [data-theme-mode="${mode}"]`), {
      hold,
      settle: () => page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, shown),
    })
  }

  // 9. Collapse the scenario list.
  await caption('Collapse the scenario list to an icon rail')
  await click(page.locator('#btn-sidebar'), { hold: 900 })

  const ms = total()
  console.log(`feature-tour.gif ${frames.length} frames, ${(ms / 1000).toFixed(1)} s, ${beat} beats`)
  if (ms < 15000 || ms > 35000) throw new Error(`feature tour runs ${ms} ms, expected 15-35 s`)
  encodeTour(frames, file, TOUR_W, TOUR_H)
}

/**
 * diagram.png: the scenario card and its diagram, dark theme, the scenario list folded to its
 * icon rail so the diagram gets the width. At the default view, which never goes past 100%.
 */
async function shootDiagram(page, file) {
  await page
    .locator('.seq-diagram')
    .getByRole('button', { name: /^Reset zoom/ })
    .click()
  // The readout settles after the next frame.
  await page.waitForTimeout(150)
  await page.locator('.seq-scroll').evaluate((el) => {
    el.scrollTop = 0
  })
  await page.evaluate(() => window.scrollTo(0, 0))
  // Grow the viewport so the description card and the whole diagram stay in frame.
  const needed = await page.evaluate(() => {
    const diagram = document.querySelector('.seq-diagram')
    return Math.ceil((diagram?.getBoundingClientRect().bottom ?? 0) + 32)
  })
  const viewport = page.viewportSize()
  const height = Math.min(Math.max(viewport.height, needed), 2400)
  if (height !== viewport.height) await page.setViewportSize({ width: viewport.width, height })
  // From the top of the page, so the top bar and the icon rail frame the scenario.
  const clip = await page.evaluate(() => {
    const d = document.querySelector('.seq-diagram').getBoundingClientRect()
    const scroll = document.querySelector('.seq-scroll')
    const s = scroll.getBoundingClientRect()
    const bottom = Math.max(d.bottom, s.top + Math.min(scroll.scrollHeight, s.height))
    return { x: 0, y: 0, width: window.innerWidth, height: Math.min(Math.ceil(bottom + 20), window.innerHeight) }
  })
  if (clip.width < 200 || clip.height < 160) throw new Error(`diagram clip is too small: ${clip.width}x${clip.height}`)
  writeFileSync(file, await page.screenshot({ clip, animations: 'disabled', caret: 'hide', type: 'png' }))
  console.log(`diagram.png ${clip.width}x${clip.height}`)
}

const { chromium } = await import('@playwright/test')
mkdirSync(path.dirname(outFile), { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  if (mode === 'tour') {
    const storage = [
      ['local', 'lsd-report-theme-v2', 'light'],
      ['local', 'lsd-report-sidebar', null],
      ['session', 'lsd-report-inspector-width', null],
    ]
    await withReportPage(
      browser,
      reportDir,
      { viewport: { width: TOUR_W, height: TOUR_H }, colorScheme: 'light' },
      storage,
      (page) => recordTour(page, outFile),
    )
  } else {
    const storage = [
      ['local', 'lsd-report-theme-v2', 'dark'],
      ['local', 'lsd-report-sidebar', 'collapsed'],
    ]
    await withReportPage(
      browser,
      reportDir,
      { viewport: { width: 1680, height: 900 }, colorScheme: 'dark' },
      storage,
      (page) => shootDiagram(page, outFile),
    )
  }
} finally {
  await browser.close()
}
console.log(outFile)
