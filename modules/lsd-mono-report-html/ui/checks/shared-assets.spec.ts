import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { uxFixture } from './ux-fixture'
import { indexBase } from '../src/lib/report-fixture.test-util'

/**
 * #64, lsd.mono.report.assets=shared: a report directory laid out as ReportWriter writes it in
 * shared mode (SharedAssetsTest pins the exact markup), opened from file://. The page holds no
 * report: it names it in <meta name="lsd-report"> and loads <stem>-report.js, then the app and its
 * styles from the files beside it. Nothing is requested from the network.
 */
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const template = join(dist, 'lsd-report.shared.html')
const stem = 'Orders-1a2b3c4d'
const script = 'lsd-report-0011223344556677.js'
const styles = 'lsd-report-8899aabbccddeeff.css'

/** A shared directory with a page for [stem]; [withData] false leaves out its `-report.js`. */
function sharedDirectory(withData: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'lsd-shared-'))
  copyFileSync(join(dist, 'shared/lsd-report.js'), join(dir, script))
  copyFileSync(join(dist, 'shared/lsd-report.css'), join(dir, styles))
  const page = readFileSync(template, 'utf8')
    .replace('href="lsd-report.css"', `href="${styles}"`)
    .replace('<script src="lsd-report.js"></script>', `<script src="${script}"></script>`)
    .replace('</head>', `<meta name="lsd-report" content="${stem}" />\n</head>`)
    .replace(`<script src="${script}">`, `<script src="${stem}-report.js"></script>\n<script src="${script}">`)
  writeFileSync(join(dir, `${stem}-diagram.html`), page)
  if (withData) {
    const report = { ...uxFixture, title: 'Orders, shared' }
    writeFileSync(
      join(dir, `${stem}-report.js`),
      `(window.__LSD_REPORTS__=window.__LSD_REPORTS__||{})[${JSON.stringify(stem)}]={report:${JSON.stringify(report)},payloadsSrc:null};\n`,
    )
  }
  return dir
}

async function open(page: Page, dir: string): Promise<{ requests: string[]; errors: string[] }> {
  const requests: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.context().route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue()
    requests.push(url)
    return route.abort()
  })
  await page.goto(pathToFileURL(join(dir, `${stem}-diagram.html`)).href)
  return { requests, errors }
}

test.beforeAll(() => {
  expect(existsSync(template), `${template} is missing: run npm run build:single (npm run check:ux does)`).toBe(true)
})

test('a shared page shows its report with the shared script, styles and fonts, offline', async ({ page }) => {
  const { requests, errors } = await open(page, sharedDirectory(true))
  await expect(page.locator('h1')).toHaveText('Orders, shared')
  await expect(page.locator('.seq-svg').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(
    await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)),
  ).toEqual(expect.arrayContaining(['Inter', 'JetBrains Mono']))
  // The styles applied: the scenario card has its border radius from the stylesheet.
  expect(
    await page
      .locator('.scenario-card')
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
  ).not.toBe('0px')
  expect(errors).toEqual([])
  expect(requests.filter((url) => !url.startsWith('https://cdn.jsdelivr.net/'))).toEqual([])
})

test('a shared page whose report data is missing names the file, not the demo', async ({ page }) => {
  const { errors } = await open(page, sharedDirectory(false))
  await expect(page.locator('h1')).toHaveText(`Report data not found: ${stem}-report.js`)
  await expect(page.locator('#app')).toContainText('copy or publish the whole directory')
  expect(errors).toEqual([])
})

test('a shared index lists the reports and opens one from its data script, offline', async ({ page }) => {
  const dir = sharedDirectory(true)
  // As ReportWriter writes a shared index: the manifest before the app script, no <meta name="lsd-report">.
  const manifest = {
    ...indexBase(),
    title: 'LSD reports',
    generatedAt: '2026-01-15T12:00:00+00:00',
    generator: { name: 'lsd-mono-jvm', version: '0.2.0' },
    reports: [
      {
        id: stem,
        title: 'Orders, shared',
        status: 'success',
        href: `${stem}-diagram.html`,
        data: `${stem}-report.js`,
        counts: { success: 1, warn: 0, error: 0, skipped: 0, aborted: 0 },
        scenarios: [
          { id: uxFixture.scenarios[0].id, title: uxFixture.scenarios[0].title, status: 'success', messageCount: 1 },
        ],
      },
    ],
  }
  const index = readFileSync(template, 'utf8')
    .replace('href="lsd-report.css"', `href="${styles}"`)
    .replace(
      '<script src="lsd-report.js"></script>',
      `<script>window.__LSD_INDEX__=${JSON.stringify(manifest)};</script>\n<script src="${script}"></script>`,
    )
  writeFileSync(join(dir, 'index.html'), index)
  const requests: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.context().route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue()
    requests.push(url)
    return route.abort()
  })
  await page.goto(pathToFileURL(join(dir, 'index.html')).href)
  await expect(page.locator('#scenario-nav')).toContainText('Orders, shared')
  await page.goto(pathToFileURL(join(dir, 'index.html')).href + `#report=${stem}`)
  await expect(page.locator('.seq-svg').first()).toBeVisible()
  expect(errors).toEqual([])
  expect(requests).toEqual([])
})
