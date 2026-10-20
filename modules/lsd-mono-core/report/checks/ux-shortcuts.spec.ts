import { expect, test } from '@playwright/test'
import { formatViolations, seriousViolations } from './ux-helpers'

// WCAG 2.1.4: the one-character shortcuts (/ j k d ?) can be turned off, and the choice is kept.

test('with single-key shortcuts off, / j k d and ? do nothing, Ctrl+K still searches, and the choice persists', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()

  // On by default: d changes the theme.
  const theme = () => page.locator('html').getAttribute('data-theme')
  const title = () => page.locator('#scenario-title').textContent()
  const start = await theme()
  await page.locator('#scenario-title').click()
  // Every press changes what is shown (#106); four go round to Auto again.
  for (let press = 0; press < 3; press++) {
    const before = await theme()
    await page.keyboard.press('d')
    expect(await theme()).not.toBe(before)
  }
  await page.keyboard.press('d')
  expect(await theme()).toBe(start)

  // The help has the switch; turn it off.
  await page.getByRole('button', { name: 'Show keyboard help' }).click()
  const toggle = page.getByRole('checkbox', { name: /Single-key shortcuts/ })
  await expect(toggle).toBeChecked()
  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
  await toggle.uncheck()
  await page.keyboard.press('Escape')
  await expect(page.locator('#help')).toHaveAttribute('data-open', 'false')

  const first = await title()
  await page.locator('#scenario-title').click()
  for (const key of ['d', 'j', 'k', '/', '?']) await page.keyboard.press(key)
  expect(await theme()).toBe(start)
  expect(await title()).toBe(first)
  await expect(page.locator('#search')).not.toBeFocused()
  await expect(page.locator('#help')).toHaveAttribute('data-open', 'false')

  // Modifier shortcuts and the arrows still work.
  await page.keyboard.press('Control+k')
  await expect(page.locator('#search')).toBeFocused()

  // Kept across a reload, like the theme.
  await page.reload()
  await expect(page.locator('.seq-svg')).toBeVisible()
  await page.locator('#scenario-title').click()
  await page.keyboard.press('d')
  expect(await theme()).toBe(start)
  await page.getByRole('button', { name: 'Show keyboard help' }).click()
  await expect(page.getByRole('checkbox', { name: /Single-key shortcuts/ })).not.toBeChecked()
})
