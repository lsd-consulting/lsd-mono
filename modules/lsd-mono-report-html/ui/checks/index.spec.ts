import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { IndexManifest } from '../src/lib/report-index'
import type { Report } from '../src/types'
import { openReport } from './open-report'
import { AXE_TAGS } from './ux-helpers'
import { uxFixture } from './ux-fixture'
import { indexBase } from '../src/lib/report-fixture.test-util'

/** The index page: the report shell with a manifest, each report's data loaded when it opens. */

const failing: Report = {
  ...uxFixture,
  title: 'Orders',
  scenarios: uxFixture.scenarios.map((s) => ({ ...s, id: 'refund', title: 'Refund', status: 'error' })),
}
const passing: Report = { ...uxFixture, title: 'Checkout' }

const manifest: IndexManifest = {
  ...indexBase(),
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

/** Opens the index in [theme] and returns the ids of the reports whose data loaded, in order. */
async function openIndex(page: Page, theme: string, hash = ''): Promise<string[]> {
  const { loaded } = await openReport(page, {
    index: { manifest, reports: { orders: failing, checkout: passing } },
    theme,
    path: `/${hash}`,
  })
  return loaded
}

/**
 * Watches the next keydown: [read] then says whether the page's own listener took it
 * (defaultPrevented), as the browser's built-in Escape in a search field would not.
 */
async function nextKeyTaken(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    const w = window as unknown as { keyTaken?: boolean }
    delete w.keyTaken
    document.addEventListener('keydown', (e) => (w.keyTaken = e.defaultPrevented), { once: true })
  })
  return () => page.evaluate(() => (window as unknown as { keyTaken?: boolean }).keyTaken === true)
}

async function serious(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze()
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
  // The default 860px viewport is the narrow layout: the list is folded to the open report.
  await page.locator('#btn-nav-fold').click()
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

test('index: Esc in Search reports clears it first, then leaves it for the open report, never the body (#114)', async ({
  page,
}) => {
  await openIndex(page, 'dark')
  const search = page.locator('#search')
  await search.click()
  await page.keyboard.type('refund')
  // The page's own clear, not the browser's (which a search field also has): it takes the key.
  const prevented = await nextKeyTaken(page)
  await page.keyboard.press('Escape')
  expect(await prevented()).toBe(true)
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await page.keyboard.press('Escape')
  const where = await page.evaluate(() => {
    const el = document.activeElement
    return el === document.body || !el ? 'BODY' : el.id || el.tagName
  })
  expect(where).not.toBe('BODY')
  expect(where).not.toBe('search')
})
