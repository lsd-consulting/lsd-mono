import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import type { IndexManifest, ReportData } from '../src/lib/report-index'
import type { Report } from '../src/types'
import { uxFixture } from './ux-fixture'
import { indexBase } from '../src/lib/report-fixture.test-util'
import { frames, requestsFlushed } from './ux-helpers'

/**
 * The production report (dist/lsd-report.html, opened from file:// as a written report is) makes
 * no network request at all, except the usage ping's jsDelivr files when the report allows them.
 * Fonts, styles and script are all inside the file. `npm run check:ux` builds it first, as page
 * version 0.2.0, so it pings as a release does.
 */

const shell = fileURLToPath(new URL('../dist/lsd-report.html', import.meta.url))
/** Sent by the check after the page's own requests (requestsFlushed); never a real host. */
const SENTINEL = 'https://sentinel.invalid/flushed'
const PING = /^https:\/\/cdn\.jsdelivr\.net\/gh\/lsd-consulting\/lsd-mono@0\.2\.0\/ping\/[a-z-]+\.txt$/

/** A report with [usagePing], or, when it is undefined, one from before the option existed. */
function report(usagePing: boolean | undefined, generator = 'lsd-mono-jvm 0.2.0'): Report {
  const options = { metricsEnabled: true, labelMaxWidth: 200, usagePing, source: 'junit' } as Report['options']
  return { ...uxFixture, generator, options }
}

/** Open the shell with [globals] set, use the page, and return every request that is not file: or data:. */
async function requestsWhile(page: Page, globals: Record<string, unknown>): Promise<string[]> {
  const requests: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.context().route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue()
    requests.push(url)
    return route.abort()
  })
  await page.addInitScript((g) => Object.assign(window, g), globals)
  await page.goto(pathToFileURL(shell).href)
  await expect(page.locator('.seq-svg').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  // The two bundled fonts are used, not a fallback.
  expect(
    await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family)),
  ).toEqual(expect.arrayContaining(['Inter', 'JetBrains Mono']))
  const metrics = page.locator('[data-show-metrics]').first()
  if (await metrics.isEnabled()) {
    await metrics.click()
    await expect(page.locator('#inspector')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  // The Components view, and a link's panel, when the report has one.
  const components = page.locator('#diagram-tab-components')
  if ((await components.count()) && (await components.getAttribute('aria-disabled')) !== 'true') {
    await components.click()
    await page.locator('.comp-scroll .edge-group').first().dispatchEvent('click')
    await expect(page.locator('#inspector')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('#diagram-tab-sequence').click()
  }
  await page.locator('button.msg-open').first().click()
  await expect(page.locator('#inspector')).toBeVisible()
  await page.keyboard.press('d')
  // The theme change has painted, and every request the page made has reached the route.
  await frames(page)
  await requestsFlushed(page, () => requests, SENTINEL)
  expect(errors).toEqual([])
  return requests.filter((url) => url !== SENTINEL)
}

test.beforeAll(() => {
  expect(existsSync(shell), `${shell} is missing: run npm run build:single (npm run check:ux does)`).toBe(true)
})

test('offline: a release report with the usage ping on requests only the ping files', async ({ page }) => {
  const requests = await requestsWhile(page, { __LSD_REPORT__: report(true) })
  expect(requests.length).toBeGreaterThan(0)
  for (const url of requests) expect(url).toMatch(PING)
})

for (const [what, data] of [
  ['the usage ping off', report(false)],
  ['no usagePing option', report(undefined)],
] as const) {
  test(`offline: a report with ${what} makes no request at all`, async ({ page }) => {
    expect(await requestsWhile(page, { __LSD_REPORT__: data })).toEqual([])
  })
}

test('offline: the built-in demo makes no request at all', async ({ page }) => {
  expect(await requestsWhile(page, {})).toEqual([])
})

test('offline: the index page with the usage ping off makes no request at all', async ({ page }) => {
  const manifest: IndexManifest = {
    ...indexBase(),
    title: 'LSD reports',
    generatedAt: '2026-01-15T12:00:00+00:00',
    generator: 'lsd-mono-jvm 0.2.0',
    options: { usagePing: false },
    reports: [
      {
        id: 'a',
        title: 'Alpha',
        status: 'success',
        href: 'a-diagram.html',
        data: 'a-report.js',
        counts: { success: 1, warn: 0, error: 0 },
        scenarios: [{ id: 'ux', title: 'Checkout', status: 'success', messages: 14 }],
      },
    ],
  }
  const data: ReportData = { report: report(false), payloadsSrc: null }
  expect(await requestsWhile(page, { __LSD_INDEX__: manifest, __LSD_REPORTS__: { a: data } })).toEqual([])
})
