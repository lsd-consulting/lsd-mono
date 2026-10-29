import { expect, test } from '@playwright/test'
import { openExample } from './example-report'

// #158: the status chips differ without colour, show off without colour, and the counts follow them.
for (const width of [390, 320]) {
  test(`phone ${width}: chips carry glyphs, keep their names, and the toggle counts the filtered list`, async ({
    page,
  }) => {
    await openExample(page, undefined, { viewport: { width, height: 844 } })
    const chips = page.locator('[data-filter]')
    await expect(chips.locator('.chip-glyph')).toHaveText(['✓', '!', '✕'])
    const success = page.locator('[data-filter="success"]')
    await expect(success).toHaveAccessibleName(/^Success \d+$/)
    const total = await page.locator('#scenario-nav [data-nav]').count()
    await success.click()
    await expect(success).toHaveAttribute('aria-pressed', 'false')
    const shown = await page.locator('#scenario-nav [data-nav]').count()
    await expect(page.locator('#btn-nav-fold .nav-fold-text')).toHaveText(`${shown} of ${total} scenarios`)
    for (const chip of await chips.all()) {
      const box = (await chip.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(24)
      expect(box.height).toBeGreaterThanOrEqual(24)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

test('desktop: the sidebar heading counts the filtered list', async ({ page }) => {
  await openExample(page, undefined, { viewport: { width: 1280, height: 900 } })
  const total = await page.locator('#scenario-nav [data-nav]').count()
  await expect(page.locator('.sidebar-title')).toHaveText(`Scenarios · ${total}`)
  await page.locator('[data-filter="success"]').click()
  const shown = await page.locator('#scenario-nav [data-nav]').count()
  await expect(page.locator('.sidebar-title')).toHaveText(`Scenarios · ${shown} of ${total}`)
})
