/**
 * Screenshot the README scenario from the report shell captureReadmeReport wrote.
 *
 * Usage: node scripts/readme-samples.mjs <report-dir> <docs-readme-dir> [feature-tour-report-dir]
 * Headless Chromium via the Playwright already used by check:ux.
 * GIFs are encoded in-process. Playwright's ffmpeg build cannot write GIF.
 *
 * Module READMEs get diagram.png, inspector.png and zoom.gif. The root README gets
 * feature-tour.gif (from the feature-tour report) and components.gif instead.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import gifenc from 'gifenc'
import pngjs from 'pngjs'

const { GIFEncoder, quantize, applyPalette } = gifenc
const { PNG } = pngjs

const reportDir = path.resolve(process.argv[2] ?? '')
const outDir = path.resolve(process.argv[3] ?? '')
const tourDir = process.argv[4] ? path.resolve(process.argv[4]) : null
/** The root README gets the feature tour and components.gif. Module samples keep the stills and zoom.gif. */
const coreMotion =
  path.basename(outDir) === 'readme' &&
  path.basename(path.dirname(outDir)) === 'docs' &&
  !outDir.includes(`${path.sep}modules${path.sep}`)
if (!process.argv[2] || !process.argv[3]) {
  console.error('usage: node scripts/readme-samples.mjs <report-dir> <docs-readme-dir> [feature-tour-report-dir]')
  process.exit(1)
}
if (coreMotion && !tourDir) {
  console.error('the root README samples need the feature-tour report dir as the third argument')
  process.exit(1)
}

const diagrams = readdirSync(reportDir).filter((name) => name.endsWith('-diagram.html'))
if (diagrams.length !== 1) {
  console.error(`expected one *-diagram.html in ${reportDir}, found ${diagrams.join(', ') || 'none'}`)
  process.exit(1)
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8'
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (file.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function serve(dir) {
  const root = path.resolve(dir)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = path.resolve(root, rel)
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403)
      res.end()
      return
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': contentType(file) })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function decodePng(buffer) {
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: png.data }
}

function scaleRgba(rgba, width, height, targetWidth) {
  if (width <= targetWidth) return { data: rgba, width, height }
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width))
  const out = new Uint8Array(targetWidth * targetHeight * 4)
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / targetHeight))
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / targetWidth))
      const si = (sy * width + sx) * 4
      const di = (y * targetWidth + x) * 4
      out[di] = rgba[si]
      out[di + 1] = rgba[si + 1]
      out[di + 2] = rgba[si + 2]
      out[di + 3] = 255
    }
  }
  return { data: out, width: targetWidth, height: targetHeight }
}

/** Area-average downscale. Keeps thin diagonal edges solid where nearest-pixel sampling breaks them up. */
function scaleRgbaSmooth(rgba, width, height, targetWidth) {
  if (width <= targetWidth) return { data: rgba, width, height }
  const targetHeight = Math.max(1, Math.round((height * targetWidth) / width))
  const out = new Uint8Array(targetWidth * targetHeight * 4)
  const fx = width / targetWidth
  const fy = height / targetHeight
  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) * fy)))
    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) * fx)))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const si = (sy * width + sx) * 4
          r += rgba[si]
          g += rgba[si + 1]
          b += rgba[si + 2]
          n++
        }
      }
      const di = (y * targetWidth + x) * 4
      out[di] = Math.round(r / n)
      out[di + 1] = Math.round(g / n)
      out[di + 2] = Math.round(b / n)
      out[di + 3] = 255
    }
  }
  return { data: out, width: targetWidth, height: targetHeight }
}

function sampleForPalette(frames) {
  const picks = [0, Math.floor(frames.length / 2), frames.length - 1]
  const chunks = []
  for (const index of picks) {
    const { data } = frames[index]
    for (let i = 0; i < data.length; i += 16) chunks.push(data[i], data[i + 1], data[i + 2], 255)
  }
  return new Uint8Array(chunks)
}

function writeGif(frames, file, { smooth = false, colours = 80 } = {}) {
  const scale = smooth ? scaleRgbaSmooth : scaleRgba
  const scaled = frames.map((frame) => scale(frame.data, frame.width, frame.height, 760))
  const palette = quantize(sampleForPalette(scaled), colours)
  const gif = GIFEncoder()
  let index = 0
  while (index < scaled.length) {
    let count = 1
    while (index + count < scaled.length && frames[index + count] === frames[index]) count++
    const frame = scaled[index]
    const indexed = applyPalette(frame.data, palette)
    gif.writeFrame(indexed, frame.width, frame.height, {
      palette,
      delay: 125 * count,
      repeat: 0,
    })
    index += count
  }
  gif.finish()
  writeFileSync(file, Buffer.from(gif.bytes()))
}

/**
 * feature-tour.gif: one pass around a small shop report, with a drawn pointer, a click ring,
 * and a caption per beat. Frames are full viewport shots at 1:1.
 *
 * One palette for the whole tour, sampled from every frame, so a colour never changes
 * between frames. Each frame then only stores the pixels that changed; the rest is the
 * transparent index, drawn over the previous frame. That keeps a 30 s tour to a few MB.
 */
const TOUR_W = 1360
const TOUR_H = 800

function tourPalette(frames) {
  const stride = 31
  const parts = frames.map((frame) => {
    const { data } = decodePng(frame.png)
    const out = new Uint8Array(Math.ceil(data.length / 4 / stride) * 4)
    for (let p = 0, o = 0; p * 4 < data.length; p += stride, o += 4) {
      out[o] = data[p * 4]
      out[o + 1] = data[p * 4 + 1]
      out[o + 2] = data[p * 4 + 2]
      out[o + 3] = 255
    }
    return out
  })
  const sample = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    sample.set(part, offset)
    offset += part.length
  }
  return quantize(sample, 255)
}

function encodeTour(frames, file) {
  const palette = tourPalette(frames)
  const transparentIndex = 255
  const padded = [...palette]
  while (padded.length < 256) padded.push([255, 0, 255])
  const gif = GIFEncoder()
  let previous = null
  for (const frame of frames) {
    const { data } = decodePng(frame.png)
    const indexed = applyPalette(data, palette)
    if (previous) {
      for (let p = 0, i = 0; p < indexed.length; p++, i += 4) {
        if (previous[i] === data[i] && previous[i + 1] === data[i + 1] && previous[i + 2] === data[i + 2]) {
          indexed[p] = transparentIndex
        }
      }
    }
    gif.writeFrame(indexed, TOUR_W, TOUR_H, {
      palette: padded,
      delay: frame.delay,
      repeat: 0,
      dispose: 1,
      ...(previous ? { transparent: true, transparentIndex } : {}),
    })
    previous = data
  }
  gif.finish()
  writeFileSync(file, Buffer.from(gif.bytes()))
}

async function recordTour(browser, tourDir, file) {
  const tourDiagrams = readdirSync(tourDir).filter((name) => name.endsWith('-diagram.html'))
  if (tourDiagrams.length !== 1) throw new Error(`expected one *-diagram.html in ${tourDir}`)
  const tourServer = await serve(tourDir)
  const tourAddress = tourServer.address()
  const tourPort = typeof tourAddress === 'object' && tourAddress ? tourAddress.port : 0
  const context = await browser.newContext({
    viewport: { width: TOUR_W, height: TOUR_H },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('lsd-report-theme', 'light')
      localStorage.removeItem('lsd-report-sidebar')
      sessionStorage.removeItem('lsd-report-inspector-width')
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`http://127.0.0.1:${tourPort}/${encodeURIComponent(tourDiagrams[0])}`, { waitUntil: 'load' })
    await page.locator('.seq-svg').first().waitFor()
    await page.locator('.msg-label').first().waitFor()
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 4000))]))

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

    // 1. Overview: scenarios with every status, and the list down the side.
    await placePointer(at.x, at.y)
    await caption('A report of every scenario, with its status')
    await snap(800)
    await moveTo(130, 190)
    await snap(300)
    await moveTo(130, 330, 6)
    await snap(700)

    // 2. Zoom.
    await caption('Zoom in and out, or Fit the diagram to the panel')
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
    await click(button('Fit to screen'), { hold: 800 })

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
    await snap(1100)

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
    await snap(1000)

    // 5. Component diagram, and a link's messages.
    await caption('See the scenario as a component diagram')
    await click(page.locator('[data-show-components]').first(), {
      hold: 1100,
      settle: () => page.locator('#inspector-graph svg.component-diagram').waitFor(),
    })
    const link = page.locator('#inspector-graph').getByRole('button', { name: 'Orders to Orders DB, 3 interactions' })
    await caption('Click a link to list the messages behind it', { sameBeat: true })
    const linkBox = await link.locator('.edge-badge').boundingBox()
    if (linkBox) {
      await moveTo(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2)
      await ring(true)
      await snap(140)
      await link.focus()
      await page.keyboard.press('Enter')
      await page.evaluate(() => document.activeElement?.blur())
      await snap(160)
      await ring(false)
      // The list sits under the drawing; bring it into the panel's view.
      await page.locator('#inspector-graph .component-links').evaluate((el) => {
        el.scrollIntoView({ block: 'end' })
      })
      const listed = await page.locator('#inspector-graph .component-links h3').boundingBox()
      if (listed) await moveTo(listed.x + 60, listed.y - 20, 5)
      await snap(1600)
    }

    // 6. Metrics.
    await caption('Metrics rank the slowest calls')
    await click(page.locator('.seq-diagram').first().getByRole('button', { name: 'Metrics', exact: true }), {
      hold: 1300,
      settle: () => page.locator('#inspector-metrics').waitFor({ state: 'visible' }),
    })
    await page.locator('#inspector-close').click()
    await page.locator('#inspector').waitFor({ state: 'hidden' })

    await find.fill('')
    await page.waitForTimeout(150)

    // 7. Hide a participant.
    await caption('Hide participants you do not need')
    await click(button('Hide Order events'), { hold: 1300 })

    // 8. Minimap.
    await caption('Drag the minimap to move through a long diagram')
    const minimap = diagram.locator('.seq-minimap-window')
    const mm = await centre(minimap)
    const track = await diagram.locator('.seq-minimap').boundingBox()
    await moveTo(mm.x, mm.y)
    await page.mouse.move(mm.x, mm.y)
    await page.mouse.down()
    await ring(true)
    await snap(120)
    const travel = track ? Math.max(40, track.y + track.height - mm.y - 30) : 160
    for (let i = 1; i <= 6; i++) {
      const y = mm.y + (travel * i) / 6
      await page.mouse.move(mm.x, y)
      await placePointer(mm.x, y)
      await ring(true)
      await snap(80)
    }
    await page.mouse.up()
    await ring(false)
    await snap(1000)

    // 9. Themes: light, high contrast, then dark.
    await caption('Light, high-contrast and dark themes')
    await page.evaluate(() => window.scrollTo(0, 0))
    await snap(200)
    await click(page.locator('#btn-theme'), { hold: 800 })
    await click(page.locator('#btn-theme'), { hold: 1100 })

    // 10. Collapse the scenario list.
    await caption('Collapse the scenario list to an icon rail')
    await click(page.locator('#btn-sidebar'), { hold: 1500 })

    const ms = total()
    console.log(`feature-tour.gif ${frames.length} frames, ${(ms / 1000).toFixed(1)} s, ${beat} beats`)
    if (ms < 15000 || ms > 35000) throw new Error(`feature tour runs ${ms} ms, expected 15-35 s`)
    encodeTour(frames, file)
  } finally {
    await context.close()
    await new Promise((resolve) => tourServer.close(resolve))
  }
}

const { chromium } = await import('@playwright/test')

const server = await serve(reportDir)
const address = server.address()
const port = typeof address === 'object' && address ? address.port : 0
const pageUrl = `http://127.0.0.1:${port}/${encodeURIComponent(diagrams[0])}`

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({
    viewport: { width: 1680, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.addInitScript((rail) => {
    localStorage.setItem('lsd-report-theme', 'dark')
    sessionStorage.setItem('lsd-report-inspector-width', '440')
    // Module stills show the scenario list as its icon rail, so the diagram gets the width.
    if (rail) localStorage.setItem('lsd-report-sidebar', 'collapsed')
    else localStorage.removeItem('lsd-report-sidebar')
  }, !coreMotion)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(pageUrl, { waitUntil: 'load' })
  await page.locator('.seq-svg').waitFor()
  await page.locator('.msg-label').first().waitFor()
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 4000))]))

  async function placeScenario() {
    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })
  }

  /** Grow the viewport so the description card and the diagram both stay in frame. */
  async function fitScenarioViewport() {
    const needed = await page.evaluate(() => {
      const card = document.querySelector('.scenario-card')
      const diagram = document.querySelector('.seq-diagram')
      const inspector = document.querySelector('#inspector-pre')
      const cardTop = card?.getBoundingClientRect().top ?? 0
      const diagramBottom = diagram?.getBoundingClientRect().bottom ?? 0
      const inspectorBottom =
        inspector && getComputedStyle(inspector).display !== 'none' ? inspector.getBoundingClientRect().bottom : 0
      return Math.ceil(Math.max(diagramBottom, inspectorBottom, cardTop) + 32)
    })
    const viewport = page.viewportSize()
    const height = Math.min(Math.max(viewport.height, needed), 2400)
    if (height !== viewport.height) {
      await page.setViewportSize({ width: viewport.width, height })
    }
  }

  async function scenarioClip() {
    await placeScenario()
    await fitScenarioViewport()
    const clip = await page.evaluate(() => {
      const diagram = document.querySelector('.seq-diagram')
      const scroll = document.querySelector('.seq-scroll')
      const d = diagram.getBoundingClientRect()
      const s = scroll.getBoundingClientRect()
      // From the top of the page, so the top bar and the icon rail frame the scenario.
      const y = 0
      const bottom = Math.max(d.bottom, s.top + Math.min(scroll.scrollHeight, s.height))
      const height = Math.ceil(bottom - y + 20)
      return {
        x: 0,
        y,
        width: window.innerWidth,
        height: Math.min(height, window.innerHeight - y),
      }
    })
    if (clip.width < 200 || clip.height < 160) {
      throw new Error(`diagram clip is too small: ${clip.width}x${clip.height}`)
    }
    return clip
  }

  const scroll = page.locator('.seq-scroll')
  if (!coreMotion) {
    const zoomIn = page.locator('.seq-diagram').getByRole('button', { name: 'Zoom in' })
    const zoomOut = page.locator('.seq-diagram').getByRole('button', { name: 'Zoom out' })
    /** Fit, then step out until labels are near their normal size. Fit alone blows a small diagram up past 200%. */
    async function fitThenEase(maxPct = 140) {
      await page.locator('.seq-diagram').getByRole('button', { name: 'Fit to screen' }).click()
      // The readout settles after the next frame; read it only then.
      await page.waitForTimeout(150)
      // Steps are 10 points, and Fit can land as high as 250%.
      for (let i = 0; i < 16; i++) {
        const pct = Number.parseInt((await page.locator('.zoom-readout').innerText()).trim(), 10)
        if (!Number.isFinite(pct) || pct <= maxPct) break
        await zoomOut.click()
        await page.waitForTimeout(150)
      }
    }
    await fitThenEase()
    await scroll.evaluate((el) => {
      el.scrollTop = 0
    })

    const clip = await scenarioClip()
    const shot = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide', type: 'png' })
    writeFileSync(path.join(outDir, 'diagram.png'), await shot())

    const frames = []
    async function hold(n) {
      const buffer = await shot()
      const decoded = decodePng(buffer)
      for (let i = 0; i < n; i++) frames.push(decoded)
    }

    await hold(5)
    // Zoom until there is a visible scroll, not just a few pixels: the full-width column
    // fits a short diagram at a large zoom.
    for (let i = 0; i < 10; i++) {
      const overflows = await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 120)
      if (overflows) break
      await zoomIn.click()
      await hold(2)
    }
    const maxScroll = await scroll.evaluate((el) => Math.max(0, el.scrollHeight - el.clientHeight))
    const steps = 8
    for (let i = 0; i <= steps; i++) {
      const top = Math.round((maxScroll * i) / steps)
      await scroll.evaluate((el, value) => {
        el.scrollTop = value
      }, top)
      await hold(1)
    }
    await hold(4)
    console.log(`captured ${frames.length} frames, clip ${clip.width}x${clip.height}`)

    for (let i = 0; i < 6; i++) await zoomOut.click()
    await scroll.evaluate((el) => {
      el.scrollTop = 0
    })
    const open = page.getByRole('button', { name: 'Open POST /orders' })
    await open.waitFor()
    await open.click()
    await page.locator('#inspector-pre').waitFor({ state: 'visible' })
    await page.waitForFunction(() => {
      const pre = document.querySelector('#inspector-pre')
      return !!pre && (pre.textContent ?? '').includes('SOCK-1')
    })
    await fitThenEase()
    await scroll.evaluate((el) => {
      el.scrollTop = 0
    })
    await placeScenario()
    await fitScenarioViewport()
    const inspectorClip = await page.evaluate(() => {
      const pre = document.querySelector('#inspector-pre')?.getBoundingClientRect()
      const diagram = document.querySelector('.seq-diagram')?.getBoundingClientRect()
      // From the top of the page, so the side panel's title and Close are in the picture.
      const top = 0
      const bottom = Math.max(pre?.bottom ?? 0, diagram?.bottom ?? 0)
      return {
        x: 0,
        y: top,
        width: window.innerWidth,
        height: Math.min(window.innerHeight - top, Math.max(420, Math.ceil(bottom - top + 20))),
      }
    })
    writeFileSync(
      path.join(outDir, 'inspector.png'),
      await page.screenshot({ clip: inspectorClip, animations: 'disabled', caret: 'hide', type: 'png' }),
    )
    writeGif(frames, path.join(outDir, 'zoom.gif'))
  }

  if (coreMotion) {
    // components.gif: a pointer moves to the Component diagram button, presses it, and the
    // diagram appears in the inspector. Fresh page at a narrower width so the text survives
    // the 760px GIF scale. Headless Chromium paints no cursor, so the pointer is an overlay.
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.reload({ waitUntil: 'load' })
    await page.locator('.seq-svg').waitFor()
    await page.locator('.msg-label').first().waitFor()
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 4000))]))
    await page.locator('.seq-diagram').getByRole('button', { name: 'Fit to screen' }).click()
    // Zoom out under Fit so the whole small diagram shows under the toolbar, as it did when
    // this clip ran after the zoom stills.
    for (let i = 0; i < 8; i++) {
      const pct = Number.parseInt((await page.locator('.zoom-readout').innerText()).trim(), 10)
      if (!Number.isFinite(pct) || pct <= 75) break
      await page.locator('.seq-diagram').getByRole('button', { name: 'Zoom out' }).click()
    }
    await scroll.evaluate((el) => {
      el.scrollTop = 0
    })
    await placeScenario()
    const button = page.locator('.seq-diagram').getByRole('button', { name: 'Component diagram' })
    await button.waitFor()

    // Open once to size the clip for both states, then close again.
    await button.click()
    await page.locator('#inspector-graph svg.component-diagram').waitFor()
    await page.waitForTimeout(250)
    // Lowest point worth keeping once open: the drawing, and the button after the column reflows.
    const openBottom = await page.evaluate(() => {
      const graph = document.querySelector('#inspector-graph')?.getBoundingClientRect()
      const again = document.querySelector('[data-show-components]')?.getBoundingClientRect()
      return Math.max(graph?.bottom ?? 0, again?.bottom ?? 0)
    })
    await page.keyboard.press('Escape')
    await page.locator('#inspector').waitFor({ state: 'hidden' })
    await page.waitForTimeout(250)
    await fitScenarioViewport()
    const componentsClip = await page.evaluate((openBottomY) => {
      const main = document.querySelector('#main')?.getBoundingClientRect()
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
      const button = document.querySelector('[data-show-components]')?.getBoundingClientRect()
      const bottom = Math.max(openBottomY, button?.bottom ?? 0) + 140
      const x = Math.max(0, Math.floor(main?.left ?? 0))
      return {
        x,
        y: Math.floor(top),
        width: window.innerWidth - x,
        height: Math.min(window.innerHeight - Math.floor(top), Math.ceil(bottom - top)),
      }
    }, openBottom)

    await page.evaluate(() => {
      const pointer = document.createElement('div')
      pointer.id = 'readme-pointer'
      pointer.style.cssText =
        'position:fixed;left:0;top:0;width:22px;height:22px;z-index:9999;pointer-events:none;transform:translate(-2px,-2px)'
      pointer.innerHTML =
        '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M2 2 L2 18 L7 13.5 L10.5 20.5 L13.5 19 L10 12 L16.5 12 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
      document.body.append(pointer)
    })
    const movePointer = (x, y) =>
      page.evaluate(
        ([px, py]) => {
          const pointer = document.querySelector('#readme-pointer')
          pointer.style.left = `${px}px`
          pointer.style.top = `${py}px`
        },
        [x, y],
      )

    const componentFrames = []
    async function holdComponents(n) {
      const decoded = decodePng(
        await page.screenshot({ clip: componentsClip, animations: 'disabled', caret: 'hide', type: 'png' }),
      )
      for (let i = 0; i < n; i++) componentFrames.push(decoded)
    }

    const target = await button.boundingBox()
    if (!target) throw new Error('Component diagram button has no box')
    const endX = target.x + target.width / 2
    const endY = target.y + target.height / 2
    const startX = componentsClip.x + componentsClip.width * 0.42
    const startY = componentsClip.y + componentsClip.height * 0.72
    await movePointer(startX, startY)
    await holdComponents(4)
    const steps = 7
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const ease = 1 - (1 - t) * (1 - t)
      await movePointer(startX + (endX - startX) * ease, startY + (endY - startY) * ease)
      await holdComponents(1)
    }
    await button.hover()
    await holdComponents(2)
    // Pressed look for one frame, then the real click.
    await button.evaluate((el) => {
      el.style.transform = 'scale(0.95)'
      el.style.background = 'var(--surface-2)'
    })
    await holdComponents(1)
    await button.evaluate((el) => {
      el.style.transform = ''
      el.style.background = ''
    })
    await button.click()
    await page.locator('#inspector-graph svg.component-diagram').waitFor()
    await page.evaluate(() => document.querySelector('#readme-pointer')?.remove())
    await page.waitForTimeout(250)
    await holdComponents(20)
    writeGif(componentFrames, path.join(outDir, 'components.gif'), { smooth: true, colours: 128 })
    console.log(`components.gif ${componentFrames.length} frames`)
  }

  if (tourDir) await recordTour(browser, tourDir, path.join(outDir, 'feature-tour.gif'))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

if (coreMotion) {
  console.log(path.join(outDir, 'components.gif'))
} else {
  console.log(path.join(outDir, 'diagram.png'))
  console.log(path.join(outDir, 'inspector.png'))
  console.log(path.join(outDir, 'zoom.gif'))
}
if (tourDir) console.log(path.join(outDir, 'feature-tour.gif'))
