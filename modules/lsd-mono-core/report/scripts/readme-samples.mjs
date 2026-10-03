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

function sampleForPalette(frames) {
  const picks = [0, Math.floor(frames.length / 2), frames.length - 1]
  const chunks = []
  for (const index of picks) {
    const { data } = frames[index]
    for (let i = 0; i < data.length; i += 16) chunks.push(data[i], data[i + 1], data[i + 2], 255)
  }
  return new Uint8Array(chunks)
}

function writeGif(frames, file) {
  const scaled = frames.map((frame) => scaleRgba(frame.data, frame.width, frame.height, 760))
  const palette = quantize(sampleForPalette(scaled), 80)
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

  async function placeDiagram() {
    await page.evaluate(() => {
      const el = document.querySelector('.seq-diagram')
      const bar = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 56
      const y = el.getBoundingClientRect().top + window.scrollY - bar - 16
      window.scrollTo(0, Math.max(0, y))
    })
  }

  async function diagramClip() {
    await placeDiagram()
    const clip = await page.evaluate(() => {
      const diagram = document.querySelector('.seq-diagram')
      const scroll = document.querySelector('.seq-scroll')
      const d = diagram.getBoundingClientRect()
      const s = scroll.getBoundingClientRect()
      const height = Math.ceil(s.top - d.top + scroll.scrollHeight + 28)
      const y = Math.max(0, Math.round(d.y))
      return {
        x: Math.max(0, Math.round(d.x)),
        y,
        width: Math.round(d.width),
        height: Math.min(height, Math.round(d.height), window.innerHeight - y),
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

  const clip = await diagramClip()
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
  await placeDiagram()
  const inspectorClip = await page.evaluate(() => {
    const pre = document.querySelector('#inspector-pre')?.getBoundingClientRect()
    const diagram = document.querySelector('.seq-diagram')?.getBoundingClientRect()
    const bottom = Math.max(pre?.bottom ?? 0, diagram?.bottom ?? 0)
    return {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: Math.min(window.innerHeight, Math.max(420, Math.ceil(bottom + 20))),
    }
  })
  writeFileSync(
    path.join(outDir, 'inspector.png'),
    await page.screenshot({ clip: inspectorClip, animations: 'disabled', caret: 'hide', type: 'png' }),
  )

  writeGif(frames, path.join(outDir, 'zoom.gif'))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

console.log(path.join(outDir, 'diagram.png'))
console.log(path.join(outDir, 'inspector.png'))
console.log(path.join(outDir, 'zoom.gif'))
