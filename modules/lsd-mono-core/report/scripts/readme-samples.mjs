/**
 * Screenshot the README scenario from the report shell captureReadmeReport wrote.
 *
 * Usage: node scripts/readme-samples.mjs <report-dir> <docs-readme-dir>
 * Headless Chromium via the Playwright already used by check:ux.
 * The GIF is encoded in-process. Playwright's ffmpeg build cannot write GIF.
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
/** Extra motion GIFs are for the root README only. Module samples keep zoom.gif. */
const coreMotion =
  path.basename(outDir) === 'readme' &&
  path.basename(path.dirname(outDir)) === 'docs' &&
  !outDir.includes(`${path.sep}modules${path.sep}`)
if (!process.argv[2] || !process.argv[3]) {
  console.error('usage: node scripts/readme-samples.mjs <report-dir> <docs-readme-dir>')
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
  await page.addInitScript(() => {
    localStorage.setItem('lsd-report-theme', 'dark')
    sessionStorage.setItem('lsd-report-inspector-width', '440')
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(pageUrl, { waitUntil: 'load' })
  await page.locator('.seq-svg').waitFor()
  await page.locator('.msg-label').first().waitFor()
  await page.evaluate(() =>
    Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 4000))]),
  )

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
        inspector && getComputedStyle(inspector).display !== 'none'
          ? inspector.getBoundingClientRect().bottom
          : 0
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
      const card = document.querySelector('.scenario-card')
      const diagram = document.querySelector('.seq-diagram')
      const scroll = document.querySelector('.seq-scroll')
      const c = card.getBoundingClientRect()
      const d = diagram.getBoundingClientRect()
      const s = scroll.getBoundingClientRect()
      const y = Math.max(0, Math.floor(Math.min(c.top, d.top)))
      const bottom = Math.max(d.bottom, s.top + Math.min(scroll.scrollHeight, s.height) )
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
  const zoomIn = page.locator('.seq-diagram').getByRole('button', { name: 'Zoom in' })
  const zoomOut = page.locator('.seq-diagram').getByRole('button', { name: 'Zoom out' })
  await page.locator('.seq-diagram').getByRole('button', { name: 'Fit to screen' }).click()
  await zoomOut.click()
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
  for (let i = 0; i < 4; i++) {
    const overflows = await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 24)
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

  if (coreMotion) {
    // Overshoot, settle, then zoom back out. One new picture per zoom step.
    const readout = page.locator('.zoom-readout')
    const fitButton = page.locator('.seq-diagram').getByRole('button', { name: 'Fit to screen' })
    const fitFrames = []
    const fitPct = await page.evaluate(() => {
      const port = document.querySelector('.seq-scroll')
      const label = document.querySelector('.zoom-readout')?.textContent ?? '100%'
      const current = Number.parseInt(label, 10) / 100 || 1
      const spacer = port.querySelector('.seq-spacer')
      const contentWidth = Number.parseFloat(spacer?.style.width || '0') / current
      const viewportWidth = port.clientWidth
      if (!(contentWidth > 0) || !(viewportWidth > 0)) return Math.round(current * 100)
      const scale = Math.min(2.5, Math.max(0.25, viewportWidth / contentWidth))
      return Math.round(scale * 100)
    })

    async function zoomSnapshot() {
      const label = (await readout.innerText()).trim()
      const size = await scroll.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
      }))
      return { label, ...size }
    }

    async function waitForChange(before) {
      await page.waitForFunction((prev) => {
        const port = document.querySelector('.seq-scroll')
        const label = (document.querySelector('.zoom-readout')?.textContent ?? '').trim()
        return (
          label !== prev.label ||
          port.scrollWidth !== prev.scrollWidth ||
          port.scrollHeight !== prev.scrollHeight
        )
      }, before, { timeout: 3000 })
    }

    function sameImage(a, b) {
      if (!a || a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false
      const step = Math.max(4, Math.floor(a.data.length / 4000) * 4)
      for (let i = 0; i < a.data.length; i += step) {
        if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
          return false
        }
      }
      return true
    }

    async function shoot(previous) {
      const decoded = decodePng(await shot())
      if (previous && sameImage(previous, decoded)) {
        throw new Error('fit.gif captured a frame that matches the previous one')
      }
      fitFrames.push(decoded)
      return decoded
    }

    await scroll.evaluate((el) => {
      el.scrollTop = 0
      el.scrollLeft = 0
    })

    let last = null
    for (let i = 0; i < 8 && fitFrames.length < 4; i++) {
      const before = await zoomSnapshot()
      const pct = Number.parseInt(before.label, 10)
      const overflows =
        before.scrollHeight > before.clientHeight + 24 || before.scrollWidth > before.clientWidth + 24
      const deep = Number.isFinite(pct) && pct >= fitPct + 20 && overflows
      if (deep && fitFrames.length >= 3) break
      await zoomIn.click()
      try {
        await waitForChange(before)
      } catch {
        if (fitFrames.length === 0 && overflows) last = await shoot(null)
        break
      }
      last = await shoot(last)
    }
    if (fitFrames.length < 1) {
      throw new Error(`fit.gif never showed an overshoot (fit target ${fitPct}%)`)
    }

    const beforeFit = await zoomSnapshot()
    await fitButton.click()
    await waitForChange(beforeFit)
    last = await shoot(last)

    let zoomedOut = 0
    for (let i = 0; i < 8 && fitFrames.length < 12; i++) {
      const pct = Number.parseInt((await readout.innerText()).trim(), 10)
      if (zoomedOut >= 4 && Number.isFinite(pct) && pct <= fitPct - 20) break
      const before = await zoomSnapshot()
      await zoomOut.click()
      try {
        await waitForChange(before)
      } catch {
        break
      }
      last = await shoot(last)
      zoomedOut++
    }
    if (fitFrames.length < 8 || fitFrames.length > 12) {
      throw new Error(`fit.gif has ${fitFrames.length} frames, expected 8-12 (fit target ${fitPct}%)`)
    }
    writeGif(fitFrames, path.join(outDir, 'fit.gif'))
    console.log(`fit.gif ${fitFrames.length} frames, fitted ${fitPct}%`)
  }

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
  await page.locator('.seq-diagram').getByRole('button', { name: 'Fit to screen' }).click()
  await zoomOut.click()
  await scroll.evaluate((el) => {
    el.scrollTop = 0
  })
  await placeScenario()
  await fitScenarioViewport()
  const inspectorClip = await page.evaluate(() => {
    const card = document.querySelector('.scenario-card')?.getBoundingClientRect()
    const pre = document.querySelector('#inspector-pre')?.getBoundingClientRect()
    const diagram = document.querySelector('.seq-diagram')?.getBoundingClientRect()
    const top = Math.max(0, Math.floor(Math.min(card?.top ?? 0, diagram?.top ?? 0)))
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

  if (coreMotion) {
    const handle = page.locator('#inspector-resize')
    await handle.waitFor()
    const box = await handle.boundingBox()
    if (!box) throw new Error('inspector resize handle has no box')
    const startX = box.x + box.width / 2
    const startY = box.y + Math.min(120, box.height / 2)
    const dragFrames = []
    async function holdDrag(n) {
      const buffer = await page.screenshot({
        clip: inspectorClip,
        animations: 'disabled',
        caret: 'hide',
        type: 'png',
      })
      const decoded = decodePng(buffer)
      for (let i = 0; i < n; i++) dragFrames.push(decoded)
    }
    await page.mouse.move(startX, startY)
    await holdDrag(2)
    await page.mouse.down()
    const distance = 320
    const steps = 8
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(startX - (distance * i) / steps, startY)
      await holdDrag(1)
    }
    await page.mouse.up()
    await holdDrag(2)
    writeGif(dragFrames, path.join(outDir, 'inspector-drag.gif'))
    console.log(`inspector-drag.gif ${dragFrames.length} frames`)
  }

  if (coreMotion) {
    // components.gif: a pointer moves to the Component diagram button, presses it, and the
    // diagram appears in the inspector. Fresh page at a narrower width so the text survives
    // the 760px GIF scale. Headless Chromium paints no cursor, so the pointer is an overlay.
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.reload({ waitUntil: 'load' })
    await page.locator('.seq-svg').waitFor()
    await page.locator('.msg-label').first().waitFor()
    await page.evaluate(() =>
      Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 4000))]),
    )
    await page.locator('.seq-diagram').getByRole('button', { name: 'Fit to screen' }).click()
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

  writeGif(frames, path.join(outDir, 'zoom.gif'))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

console.log(path.join(outDir, 'diagram.png'))
console.log(path.join(outDir, 'inspector.png'))
console.log(path.join(outDir, 'zoom.gif'))
if (coreMotion) {
  console.log(path.join(outDir, 'fit.gif'))
  console.log(path.join(outDir, 'inspector-drag.gif'))
  console.log(path.join(outDir, 'components.gif'))
}
