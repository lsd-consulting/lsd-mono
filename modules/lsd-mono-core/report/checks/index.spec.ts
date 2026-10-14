import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { IndexManifest } from '../src/lib/report-index'
import type { Report } from '../src/types'
import { uxFixture } from './ux-fixture'

/** The index page: the report shell with a manifest, each report's data loaded when it opens. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const failing: Report = {
  ...uxFixture,
  title: 'Orders',
  scenarios: uxFixture.scenarios.map((s) => ({ ...s, id: 'refund', title: 'Refund', status: 'error' })),
}
const passing: Report = { ...uxFixture, title: 'Checkout' }

const manifest: IndexManifest = {
  title: 'LSD reports',
  generatedAt: '2026-01-15T12:00:00+00:00',
  generator: 'ux-fixture',
  reports: [
    {
      id: 'orders',
      title: 'Orders',
      status: 'error',
      href: 'orders-diagram.html',
      data: 'orders-report.js',
      counts: { success: 0, warn: 0, error: 1 },
      scenarios: [{ id: 'refund', title: 'Refund', status: 'error', messages: 14 }],
    },
    {
      id: 'checkout',
      title: 'Checkout',
      status: 'success',
      href: 'checkout-diagram.html',
      data: 'checkout-report.js',
      counts: { success: 1, warn: 0, error: 0 },
      scenarios: [{ id: 'ux', title: 'Checkout', status: 'success', messages: 14 }],
    },
  ],
}

function dataScript(id: string, report: Report): string {
  return `(window.__LSD_REPORTS__=window.__LSD_REPORTS__||{})[${JSON.stringify(id)}]={report:${JSON.stringify(report)},payloadsSrc:null};`
}

async function openIndex(page: Page, theme: string, hash = ''): Promise<string[]> {
  const loaded: string[] = []
  await page.addInitScript(
    ({ index, themeName }) => {
      window.__LSD_INDEX__ = index
      localStorage.setItem('lsd-report-theme', themeName)
    },
    { index: manifest, themeName: theme },
  )
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
  for (const [id, report] of [
    ['orders', failing],
    ['checkout', passing],
  ] as const) {
    await page.route(`**/${id}-report.js`, (route) => {
      loaded.push(id)
      return route.fulfill({ contentType: 'text/javascript', body: dataScript(id, report) })
    })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/${hash}`)
  await expect(page.locator('.seq-svg')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return loaded
}

async function serious(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
}

for (const theme of ['dark', 'light', 'contrast']) {
  test(`index: axe in ${theme}, failed report opens first and only its data loads`, async ({ page }) => {
    const loaded = await openIndex(page, theme)
    expect(loaded).toEqual(['orders'])
    await expect(page.locator('.hero-index')).toContainText('report 1 of 2')
    await expect(page).toHaveTitle('Orders · LSD reports')
    expect(await serious(page)).toEqual([])
  })
}

test('index: choosing another report loads it and names it in the URL', async ({ page }) => {
  const loaded = await openIndex(page, 'dark')
  await page.locator('.nav-group-head[data-group="checkout"]').click()
  await page.locator('[data-report="checkout"][data-nav]').first().click()
  await expect(page.locator('.hero-index')).toContainText('report 2 of 2')
  expect(loaded).toEqual(['orders', 'checkout'])
  expect(new URL(page.url()).hash).toContain('report=checkout')
  expect(await serious(page)).toEqual([])
})

test('index: a #report= link opens that report directly', async ({ page }) => {
  const loaded = await openIndex(page, 'light', '#report=checkout&scenario=ux')
  await expect(page.locator('.hero-index')).toContainText('report 2 of 2')
  expect(loaded).toEqual(['checkout'])
})

test('index: on a phone the report list sits above the diagram and passes axe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openIndex(page, 'dark')
  await expect(page.locator('.index-nav')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(await serious(page)).toEqual([])
})
