import { expect, test } from '@playwright/test'
import { openExample } from './example-report'

// #162: search still shows the first match, and clearing it goes back to where you were.
const opened = (page: import('@playwright/test').Page) => page.locator('.scenario-card').getAttribute('id')

for (const how of ['button', 'Escape', 'delete'] as const) {
  test(`clearing search with ${how} restores the scenario open before it`, async ({ page }) => {
    await openExample(page, '133', { viewport: { width: 1280, height: 900 } })
    const before = await opened(page)
    const search = page.getByRole('searchbox', { name: 'Search scenarios' })
    const clear = page.getByRole('button', { name: 'Clear search' })
    await expect(clear).toBeHidden()
    await search.fill('stock')
    await expect.poll(() => opened(page)).not.toBe(before)
    await expect(clear).toBeVisible()
    if (how === 'button') await clear.click()
    else if (how === 'Escape') await search.press('Escape')
    else await search.fill('')
    await expect(search).toHaveValue('')
    await expect(search).toBeFocused()
    await expect.poll(() => opened(page)).toBe(before)
    await expect(clear).toBeHidden()
  })
}

test('the clear button is at least 24×24 and the count is announced politely', async ({ page }) => {
  await openExample(page, undefined, { viewport: { width: 390, height: 844 } })
  const search = page.getByRole('searchbox', { name: 'Search scenarios' })
  await search.fill('declined')
  const box = (await page.getByRole('button', { name: 'Clear search' }).boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(24)
  expect(box.height).toBeGreaterThanOrEqual(24)
  const status = page.locator('#search-status')
  await expect(status).toHaveAttribute('aria-live', 'polite')
  await expect(status).toHaveText(/^\d+ of \d+ scenarios?$/)
})
