import { expect, test } from '@playwright/test'
import { openExample } from './example-report'

// #163: what each status means, reachable by keyboard and screen reader, and a Warn scenario's reason.
test('the ? by the chips opens the status legend from the keyboard, and Esc closes it back to the button', async ({
  page,
}) => {
  await openExample(page, '133', { viewport: { width: 1280, height: 900 } })
  const btn = page.getByRole('button', { name: 'What the statuses mean' })
  await expect(btn).toHaveAttribute('aria-expanded', 'false')
  await btn.focus()
  await page.keyboard.press('Enter')
  const legend = page.getByRole('region', { name: 'What the statuses mean' })
  await expect(legend).toBeVisible()
  await expect(legend).toContainText('neither passed nor failed')
  await page.keyboard.press('Escape')
  await expect(legend).toBeHidden()
  await expect(btn).toBeFocused()
  await expect(page.locator('[data-filter="warn"]')).toHaveAccessibleDescription(/neither passed nor failed/)
  await expect(page.locator('.scenario-head .badge')).toHaveAccessibleDescription(/neither passed nor failed/)
})

test('a Warn scenario says why it is Warn', async ({ page }) => {
  await openExample(page, '133', { viewport: { width: 1280, height: 900 } })
  await expect(page.locator('#card-133 .warn-reason')).toHaveText(
    'Marked Warn because: an assumption failed, so the test was aborted rather than failed.',
  )
})

test('the legend fits a 320 px phone', async ({ page }) => {
  await openExample(page, undefined, { viewport: { width: 320, height: 640 } })
  await page.getByRole('button', { name: 'What the statuses mean' }).click()
  const box = (await page.locator('#status-legend').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})
