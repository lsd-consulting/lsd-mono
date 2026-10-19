import { expect, test } from '@playwright/test'
import { openFindIndex, openFindReport } from './find-fixture'

// Find in payloads (#60): the arrows whose payload matches count and step like label matches.

for (const [pageName, open] of Object.entries({ report: openFindReport, index: openFindIndex })) {
  test(`find (${pageName} page): payload matches count, step and are named like label matches`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await open(page)
    const find = page.locator('[data-diagram-find]')
    const count = page.locator('.diagram-find-count')
    await find.click()
    await page.keyboard.type('snowdrop', { delay: 10 })
    await expect(count).toHaveText('1 of 3, 2 in payloads')
    await expect(page.locator('.msg-open[aria-label^="Open place order, current search match"]')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(count).toHaveText('2 of 3, 2 in payloads')
    await expect(page.locator('.seq-svg .search-current .msg-label')).toContainText('reserve stock')
    await page.keyboard.press('Enter')
    await expect(page.locator('.seq-svg .search-current .msg-label')).toContainText('snowdrop applied')
    await page.keyboard.press('Enter')
    await expect(count).toHaveText('1 of 3, 2 in payloads')
    // A query only a deferred payload holds.
    await find.fill('sock-1')
    await expect(count).toHaveText('1 of 2, 2 in payloads')
    await find.fill('nowhere at all')
    await expect(count).toHaveText('0 matches')
    await expect(page.locator('#inspector')).toBeHidden()
  })
}
