import { devices, expect, test, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { openIndex } from './diagram-pages'
import { uxFixture } from './ux-fixture'

/**
 * The phone layout: the scenario list folds to the selected item under an "N scenarios"
 * disclosure, and search sits on one row with the status chips.
 */
const PHONES = {
  iPhone: devices['iPhone 13'],
  Pixel: devices['Pixel 7'],
} as const

const base = uxFixture.scenarios[0]
const phoneReport: Report = {
  ...uxFixture,
  scenarios: ['One', 'Two', 'Three', 'Four'].map((title, i) => ({ ...base, id: `sc${i + 1}`, title })),
}

const shownNavItems = (page: Page) =>
  page
    .locator('#scenario-nav [data-nav]')
    .evaluateAll((els) =>
      els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => el.textContent?.trim().split('\n')[0]),
    )

async function open(page: Page, which: 'report' | 'index', hash = ''): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (which === 'report') {
    await page.addInitScript((r) => {
      window.__LSD_REPORT__ = r
    }, phoneReport)
    await page.goto(`/${hash}`)
  } else {
    // The index fixture lists one report with one scenario, id "sections".
    await openIndex(page, { ...phoneReport, scenarios: [{ ...base, id: 'sections', title: 'Sections' }] })
  }
  await expect(page.locator('.seq-svg')).toBeVisible()
}

for (const [phone, device] of Object.entries(PHONES)) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = device
  test.describe(`phone layout on ${phone}`, () => {
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('the scenario list folds to the selected one; the disclosure opens it and choosing folds it again', async ({
      page,
    }) => {
      await open(page, 'report')
      const toggle = page.locator('#btn-nav-fold')
      await expect(toggle).toHaveText(/4 scenarios/)
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle).toHaveAttribute('aria-controls', 'scenario-nav')
      expect(await shownNavItems(page)).toHaveLength(1)

      await toggle.focus()
      await page.keyboard.press('Enter')
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(await shownNavItems(page)).toHaveLength(4)

      await page.locator('#scenario-nav [data-nav="sc3"]').tap()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('#scenario-title')).toHaveText('Three')
      await expect(page.locator('#scenario-nav [aria-current="true"]')).toHaveAttribute('data-nav', 'sc3')
      expect(await shownNavItems(page)).toHaveLength(1)
    })

    test('a deep link selects its scenario in the folded list, and a search lists every match', async ({ page }) => {
      await open(page, 'report', '#scenario=sc4')
      await expect(page.locator('#scenario-title')).toHaveText('Four')
      expect(await shownNavItems(page)).toHaveLength(1)
      await expect(page.locator('#scenario-nav [aria-current="true"]')).toHaveAttribute('data-nav', 'sc4')
      await page.locator('#search').fill('o')
      await expect(page.locator('#btn-nav-fold')).toBeHidden()
      expect((await shownNavItems(page)).length).toBeGreaterThan(1)
    })

    test('search and the status chips share one row, and each chip keeps its name', async ({ page }) => {
      await open(page, 'report')
      const search = await page.locator('.search-wrap').boundingBox()
      const chips = await page.locator('.filters').boundingBox()
      expect(Math.abs(search!.y + search!.height / 2 - (chips!.y + chips!.height / 2))).toBeLessThan(4)
      await expect(page.locator('.filters [data-filter="success"]')).toHaveAccessibleName(/^Success/)
    })

    test('index: the report list folds to the open report', async ({ page }) => {
      await open(page, 'index')
      await expect(page.locator('#btn-nav-fold')).toHaveText(/1 report\b/)
      await expect(page.locator('#btn-nav-fold')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('#scenario-nav [aria-current="true"]')).toBeVisible()
    })
  })
}
