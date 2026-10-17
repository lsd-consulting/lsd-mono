import { devices, expect, test, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { openIndex, sectionsReport } from './diagram-pages'
import { uxFixture } from './ux-fixture'
import { pendingReport, scenarioPartTops } from './ux-helpers'

/**
 * The phone layout: the scenario list folds to the selected item under an "N scenarios"
 * disclosure, and search sits on one row with the status chips.
 */
const PHONES = {
  iPhone: devices['iPhone 13'],
  Pixel: devices['Pixel 7'],
} as const

// The fixture's description and facts, with a diagram tall enough to scroll through.
const tall = sectionsReport(30).scenarios[0]
const base = { ...uxFixture.scenarios[0], participants: tall.participants, events: tall.events }
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

async function open(page: Page, which: 'report' | 'index', hash = '', report: Report = phoneReport): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (which === 'report') {
    await page.addInitScript((r) => {
      window.__LSD_REPORT__ = r
    }, report)
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

    test('Metrics and Component diagram share a toolbar row inside the card, as 44px touch targets', async ({
      page,
    }) => {
      await open(page, 'report')
      const toolbar = page.locator('.seq-toolbar')
      const bar = (await toolbar.boundingBox())!
      expect(await toolbar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
      const boxes = []
      for (const name of ['Metrics', 'Component diagram']) {
        const button = toolbar.getByRole('button', { name, exact: true })
        const box = (await button.boundingBox())!
        expect(box.height, name).toBeGreaterThanOrEqual(44)
        expect(box.x, name).toBeGreaterThanOrEqual(bar.x)
        expect(box.x + box.width, name).toBeLessThanOrEqual(bar.x + bar.width + 0.5)
        boxes.push(box)
      }
      expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1)
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

    for (const which of ['report', 'index'] as const) {
      test(`${which}: scrolling slides the top bar's first row away, search stays, the toolbar sticks below it, nothing jumps`, async ({
        page,
      }) => {
        await open(page, which)
        const measure = () =>
          page.evaluate(() => {
            const bar = document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect()
            const panel = document.querySelector<HTMLElement>('.diagram-panel')!.getBoundingClientRect()
            const search = document.querySelector<HTMLElement>('.search-wrap')!.getBoundingClientRect()
            const brand = document.querySelector<HTMLElement>('.brand')!.getBoundingClientRect()
            const toolbar = document.querySelector<HTMLElement>('.seq-toolbar')!.getBoundingClientRect()
            const find = document.querySelector<HTMLElement>('.diagram-find')!.getBoundingClientRect()
            return {
              findTop: find.top,
              barBottom: bar.bottom,
              barHeight: bar.height,
              panelDocTop: panel.top + scrollY,
              searchTop: search.top,
              brandBottom: brand.bottom,
              toolbarDocTop: toolbar.top + scrollY,
              stuck: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')),
            }
          })
        const before = await measure()
        expect(before.barHeight).toBeGreaterThan(80) // two rows at the top of the page
        const panelTop = before.panelDocTop
        // Well into the diagram, past where its toolbar starts.
        await page.evaluate((y) => scrollTo(0, y + 300), before.toolbarDocTop)
        await page.waitForTimeout(100)
        const after = await measure()
        expect(after.barBottom).toBeLessThanOrEqual(64)
        expect(Math.abs(after.barBottom - after.stuck)).toBeLessThanOrEqual(1)
        expect(after.brandBottom).toBeLessThanOrEqual(1)
        expect(after.searchTop).toBeGreaterThanOrEqual(0)
        // Only the toolbar's Find row stays, just under the bar.
        expect(after.findTop).toBeGreaterThanOrEqual(after.barBottom)
        expect(after.findTop).toBeLessThanOrEqual(after.barBottom + 12)
        expect(after.panelDocTop).toBe(panelTop)
        await expect(page.locator('[data-diagram-find]')).toBeInViewport()
        await expect(page.locator('[data-find-step="next"]')).toBeInViewport()
      })
    }

    // Same reading order as on a desktop: what the scenario is and why it ended, then its diagram.
    test('the description, its reason and the key facts come before the diagram', async ({ page }) => {
      await open(page, 'report', '', pendingReport)
      const at = await scenarioPartTops(page)
      expect(at.description).toBeLessThan(at.error)
      expect(at.error).toBeLessThan(at.facts)
      expect(at.facts).toBeLessThan(at.diagram)
    })

    test('index: the report list folds to the open report', async ({ page }) => {
      await open(page, 'index')
      await expect(page.locator('#btn-nav-fold')).toHaveText(/1 report\b/)
      await expect(page.locator('#btn-nav-fold')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('#scenario-nav [aria-current="true"]')).toBeVisible()
    })
  })
}
