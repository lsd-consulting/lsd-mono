import { expect, test, type Page, type Request } from '@playwright/test'
import type { IndexManifest } from '../src/lib/report-index'
import type { Report } from '../src/types'
import { openReport } from './open-report'
import { uxFixture } from './ux-fixture'
import { indexBase } from '../src/lib/report-fixture.test-util'
import { requestsFlushed } from './ux-helpers'

/**
 * The usage ping (src/lib/usage-ping.ts). The dev server never pings, so these pages opt in with
 * `?lsd-usage-ping-check`, which only the dev build reads. Every jsDelivr request is recorded and
 * then failed, so nothing reaches the CDN and the page has to cope with a blocked or offline ping.
 */

const CDN = 'https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@0.2.0/ping/'
const OPT_IN = '/?lsd-usage-ping-check'
/** Sent by the check itself, after the page's own requests (requestsFlushed). */
const SENTINEL = 'sentinel.txt'

function report(options: Partial<NonNullable<Report['options']>>, generator = 'lsd-mono-jvm 0.2.0'): Report {
  return {
    ...uxFixture,
    generator,
    options: { metricsEnabled: true, labelMaxWidth: 200, usagePing: true, source: 'junit', ...options },
  }
}

interface Opened {
  pings: Request[]
  /** Console errors and page errors, leaving out the browser's own line for the failed request. */
  errors: string[]
}

async function open(page: Page, data: Report, path = OPT_IN, failWith = 'blockedbyclient'): Promise<Opened> {
  const opened: Opened = { pings: [], errors: [] }
  page.on('pageerror', (e) => opened.errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) opened.errors.push(m.text())
  })
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    opened.pings.push(route.request())
    return route.abort(failWith)
  })
  await openReport(page, { report: data, path, wait: 'labels' })
  return opened
}

const files = (pings: Request[]) => pings.map((r) => r.url().replace(CDN, ''))

/** The rendered page, without the parts that change on their own (focus, hover). */
const appHtml = (page: Page) => page.locator('#app').evaluate((el) => el.innerHTML)

for (const failWith of ['blockedbyclient', 'internetdisconnected']) {
  test(`usage ping: sent once per event, and a ${failWith} request changes nothing`, async ({ page, browser }) => {
    const opened = await open(page, report({}), OPT_IN, failWith)
    await expect.poll(() => files(opened.pings)).toEqual(['report-open.txt', 'source-junit.txt'])
    for (const ping of opened.pings) {
      expect(new URL(ping.url()).search).toBe('')
      const headers = await ping.allHeaders()
      expect(headers.cookie).toBeUndefined()
      expect(headers.referer).toBeUndefined()
    }

    // The same report with the ping off renders the same page.
    const quiet = await browser.newPage()
    const off = await open(quiet, report({ usagePing: false }))
    expect(await appHtml(page)).toBe(await appHtml(quiet))
    expect(off.pings).toEqual([])
    await quiet.close()

    const metrics = page.locator('.diagram-pane:not([hidden]) [data-show-metrics]').first()
    for (let i = 0; i < 2; i++) {
      await metrics.click()
      await expect(page.locator('#inspector')).toBeVisible()
      await page.keyboard.press('Escape')
      // Showing the Components view is the event, once per page.
      await page.locator('#diagram-tab-components').click()
      await expect(page.locator('.comp-scroll')).toBeVisible()
      await page.locator('#diagram-tab-sequence').click()
    }
    await expect
      .poll(() => files(opened.pings))
      .toEqual(['report-open.txt', 'source-junit.txt', 'metrics-open.txt', 'components-open.txt'])
    expect(opened.errors).toEqual([])
  })
}

for (const [what, data, path] of [
  ['usagePing is false', report({ usagePing: false }), OPT_IN],
  ['the report is from a snapshot build', report({}, 'lsd-mono-jvm 0.2.1-SNAPSHOT'), OPT_IN],
  ['the report has no usagePing option', report({ usagePing: undefined }), OPT_IN],
  ['the page is the dev server without the opt-in', report({}), '/'],
] as const) {
  test(`usage ping: no request at all when ${what}`, async ({ page }) => {
    const opened = await open(page, data, path)
    await page.locator('[data-show-metrics]').first().click()
    await expect(page.locator('#inspector')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('#diagram-tab-components').click()
    await expect(page.locator('.comp-scroll')).toBeVisible()
    // Every request made so far has reached the route once a sentinel sent after them has.
    await requestsFlushed(page, () => opened.pings.map((r) => r.url()), `${CDN}${SENTINEL}`)
    expect(files(opened.pings)).toEqual([SENTINEL])
    expect(opened.errors).toEqual([])
  })
}

test('usage ping: the index page pings on open and counts each opened report source once', async ({ page }) => {
  const pings: string[] = []
  const manifest: IndexManifest = {
    ...indexBase(),
    title: 'LSD reports',
    generatedAt: '2026-01-15T12:00:00+00:00',
    generator: 'lsd-mono-jvm 0.2.0',
    options: { usagePing: true },
    reports: ['a', 'b'].map((id) => ({
      id,
      title: id === 'a' ? 'Alpha' : 'Beta',
      status: 'success' as const,
      href: `${id}-diagram.html`,
      data: `${id}-report.js`,
      counts: { success: 1, warn: 0, error: 0 },
      scenarios: [{ id: 'ux', title: 'Checkout', status: 'success' as const, messages: 14 }],
    })),
  }
  await page.route('https://cdn.jsdelivr.net/**', (route) => {
    pings.push(route.request().url().replace(CDN, ''))
    return route.abort()
  })
  const titled = (title: string) => ({ ...report({ source: 'cucumber' }), title })
  await openReport(page, { index: { manifest, reports: { a: titled('Alpha'), b: titled('Beta') } }, path: OPT_IN })
  await page.goto(`${OPT_IN}#report=b&scenario=ux`)
  await expect(page).toHaveTitle('Beta · LSD reports')
  await expect.poll(() => pings).toEqual(['report-open.txt', 'source-cucumber.txt'])
})
