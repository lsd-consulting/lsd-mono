import { expect, test, type Page } from '@playwright/test'
import { seriousViolations, formatViolations, threeScenarios } from './ux-helpers'

// Themes: follow the OS, explicit choice, high contrast, Auto.

// The default theme follows the OS (prefers-color-scheme, prefers-contrast); a choice wins.

async function openOs(page: Page, colorScheme: 'dark' | 'light', contrast: 'more' | 'no-preference' = 'no-preference') {
  await page.addInitScript((report) => {
    window.__LSD_REPORT__ = report
  }, threeScenarios)
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme, contrast })
}

test('with no choice stored the theme follows the OS, live, and is never stored', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openOs(page, 'light')
  // No flash: hold the app script and look at the page the head script left.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(/\/src\/main\.ts/, async (route) => {
    await held
    await route.continue()
  })
  const loading = page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('#app')).toBeEmpty()
  release()
  await loading
  await expect(page.locator('.seq-svg')).toBeVisible()
  await expect(page.locator('#btn-theme')).toHaveAccessibleName('Theme: Auto (light). Switch to dark')
  await expect(page.locator('#btn-theme')).toHaveText('A')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('#btn-theme')).toHaveAccessibleName(/^Theme: Auto \(dark\)\./)
  await page.emulateMedia({ contrast: 'more' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
  await page.emulateMedia({ contrast: 'no-preference', colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('lsd-report-theme'))).toBeNull()

  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
})

test('an explicit theme choice, high contrast included, persists and wins over the OS', async ({ page }) => {
  await openOs(page, 'dark')
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // Auto → dark → light → high contrast
  await page.locator('#btn-theme').click()
  await page.locator('#btn-theme').click()
  await page.locator('#btn-theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
  expect(await page.evaluate(() => localStorage.getItem('lsd-report-theme'))).toBe('contrast')

  await page.emulateMedia({ colorScheme: 'light' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
  await page.reload()
  await expect(page.locator('.seq-svg')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
  await expect(page.locator('#btn-theme')).toHaveText('HC')
})

test('an OS asking for more contrast gets high contrast by default', async ({ page }) => {
  await openOs(page, 'dark', 'more')
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
})

test('Auto, from the button or `d`, clears the choice and follows the OS again', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('lsd-report-theme', 'contrast')
    }
  })
  await openOs(page, 'dark')
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
  const btn = page.locator('#btn-theme')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast')
  await expect(btn).toHaveAccessibleName('Theme: high contrast. Switch to Auto (follow the OS)')

  await btn.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(btn).toHaveText('A')
  await expect(btn).toHaveAccessibleName('Theme: Auto (dark). Switch to dark')
  await expect(btn).toHaveAttribute('title', 'Theme: Auto (dark). Switch to dark')
  expect(await page.evaluate(() => localStorage.getItem('lsd-report-theme'))).toBeNull()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(btn).toHaveAccessibleName('Theme: Auto (light). Switch to dark')
  await page.reload()
  await expect(page.locator('.seq-svg')).toBeVisible()
  await expect(btn).toHaveAccessibleName('Theme: Auto (light). Switch to dark')

  // The `d` key walks the same cycle: dark, light, high contrast, Auto.
  await page.locator('body').click({ position: { x: 5, y: 300 } })
  for (const expected of ['dark', 'light', 'contrast']) {
    await page.keyboard.press('d')
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected)
  }
  await page.keyboard.press('d')
  await expect(btn).toHaveText('A')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await page.evaluate(() => localStorage.getItem('lsd-report-theme'))).toBeNull()
  await page.locator('#btn-help').click()
  await expect(page.locator('#help')).toContainText('Auto follows the OS')

  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
})
