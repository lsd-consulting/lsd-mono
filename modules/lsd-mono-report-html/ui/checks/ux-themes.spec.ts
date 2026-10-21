import { expect, test, type Page } from '@playwright/test'
import { openReport } from './open-report'
import AxeBuilder from '@axe-core/playwright'
import { AXE_TAGS, seriousViolations, formatViolations, threeScenarios } from './ux-helpers'

// Themes (#106): the theme menu (Auto, Light, Dark, High contrast), the `d` cycle, the OS
// default, other tabs, and the move to a versioned stored key.

const KEY = 'lsd-report-theme-v2'
const LEGACY = 'lsd-report-theme'
type Mode = 'auto' | 'light' | 'dark' | 'contrast'

async function openOs(page: Page, colorScheme: 'dark' | 'light', contrast: 'more' | 'no-preference' = 'no-preference') {
  await openReport(page, { report: threeScenarios, media: { colorScheme, contrast }, navigate: false })
}

async function load(page: Page) {
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
}

const stored = (page: Page, key = KEY) => page.evaluate((k) => localStorage.getItem(k), key)
const btn = (page: Page) => page.locator('#btn-theme')
const menu = (page: Page) => page.locator('#theme-menu')

async function choose(page: Page, mode: Mode) {
  await btn(page).click()
  await menu(page).locator(`[data-theme-mode="${mode}"]`).click()
  await expect(menu(page)).toBeHidden()
}

/** The button, the checked menu item, `data-theme` and the store all say the same thing. */
async function expectInStep(page: Page, mode: Mode, theme: 'light' | 'dark' | 'contrast') {
  const names = {
    auto: `A. Theme: Auto (${theme === 'contrast' ? 'high contrast' : theme})`,
    light: 'Theme: light',
    dark: 'Theme: dark',
    contrast: 'HC. Theme: high contrast',
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await expect(btn(page)).toHaveAccessibleName(names[mode])
  await expect(menu(page).locator('[aria-checked="true"]')).toHaveCount(1)
  await expect(menu(page).locator('[aria-checked="true"]')).toHaveAttribute('data-theme-mode', mode)
  expect(await stored(page)).toBe(mode === 'auto' ? null : mode)
  // The icon shows the current mode: A, a sun for light, a moon for dark, HC.
  if (mode === 'auto') await expect(btn(page)).toHaveText('A')
  if (mode === 'contrast') await expect(btn(page)).toHaveText('HC')
  if (mode === 'light') await expect(btn(page).locator('svg circle')).toHaveCount(1)
  if (mode === 'dark') await expect(btn(page).locator('svg path')).toHaveAttribute('d', /^M20\.985/)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const os of ['light', 'dark'] as const) {
    test(`a first load at ${viewport.width}px on a ${os} OS is Auto, showing the OS theme, and stores nothing`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await openOs(page, os)
      await load(page)
      await expect(btn(page)).toBeVisible()
      await expectInStep(page, 'auto', os)
      expect(await stored(page, LEGACY)).toBeNull()
    })
  }
}

test('with no choice stored the theme follows the OS before first paint and live', async ({ page }) => {
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
  await expectInStep(page, 'auto', 'light')

  await page.emulateMedia({ colorScheme: 'dark' })
  await expectInStep(page, 'auto', 'dark')
  await page.emulateMedia({ contrast: 'more' })
  await expectInStep(page, 'auto', 'contrast')
  await page.emulateMedia({ contrast: 'no-preference', colorScheme: 'light' })
  await expectInStep(page, 'auto', 'light')
})

test('an OS asking for more contrast gets high contrast by default', async ({ page }) => {
  await openOs(page, 'dark', 'more')
  await load(page)
  await expectInStep(page, 'auto', 'contrast')
})

test('each menu choice shows its own icon, is checked, persists, and wins over the OS', async ({ page }) => {
  await openOs(page, 'dark')
  await load(page)
  // Dark from Auto (dark) changes nothing on screen, but it is a deliberate pin: stored and checked.
  await choose(page, 'dark')
  await expectInStep(page, 'dark', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expectInStep(page, 'dark', 'dark')
  for (const mode of ['light', 'contrast', 'dark'] as const) {
    await choose(page, mode)
    await expectInStep(page, mode, mode)
    await page.reload()
    await expect(page.locator('.seq-svg')).toBeVisible()
    await expectInStep(page, mode, mode)
  }
  // Auto forgets the choice and follows the OS again, live.
  await choose(page, 'auto')
  await expectInStep(page, 'auto', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expectInStep(page, 'auto', 'dark')
  await page.emulateMedia({ contrast: 'more' })
  await expectInStep(page, 'auto', 'contrast')
})

test('`d` steps the modes and never leaves the page as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openOs(page, 'dark')
  await load(page)
  await page.locator('body').click({ position: { x: 5, y: 300 } })
  // From Auto (dark): light, dark, high contrast, then Auto (dark) again.
  const steps = [
    ['light', 'light'],
    ['dark', 'dark'],
    ['contrast', 'contrast'],
    ['auto', 'dark'],
  ] as const
  for (const [mode, theme] of steps) {
    const before = await page.locator('html').getAttribute('data-theme')
    await page.keyboard.press('d')
    await expectInStep(page, mode, theme)
    expect(theme).not.toBe(before)
  }
  await page.locator('#btn-help').click()
  await expect(page.locator('#help')).toContainText('Auto follows the OS, light, dark, high contrast')
})

test('a choice in one tab shows in the other without a reload', async ({ page, context }) => {
  await openOs(page, 'dark')
  await load(page)
  const other = await context.newPage()
  await openOs(other, 'dark')
  await load(other)
  await choose(page, 'light')
  await expectInStep(other, 'light', 'light')
  await choose(page, 'contrast')
  await expectInStep(other, 'contrast', 'contrast')
  await choose(page, 'auto')
  await expectInStep(other, 'auto', 'dark')
  await other.close()
})

test('a choice stored under the old key is dropped once, so the page starts on Auto', async ({ page }) => {
  await openReport(page, {
    report: threeScenarios,
    storage: { [LEGACY]: 'dark' },
    media: { colorScheme: 'light' },
    navigate: false,
  })
  await load(page)
  await expectInStep(page, 'auto', 'light')
  expect(await stored(page, LEGACY)).toBeNull()
})

test('the menu works by keyboard: open, move, choose, Escape back to the button', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openOs(page, 'dark')
  await load(page)
  await btn(page).focus()
  await page.keyboard.press('Enter')
  await expect(menu(page)).toBeVisible()
  await expect(btn(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(menu(page).locator('[data-theme-mode="auto"]')).toBeFocused()
  // Page keys keep off the menu: `d` moves to Dark there (type-ahead) but changes nothing yet.
  await page.keyboard.press('d')
  await expect(menu(page).locator('[data-theme-mode="dark"]')).toBeFocused()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await stored(page)).toBeNull()
  await page.keyboard.press('ArrowUp')
  await expect(menu(page).locator('[data-theme-mode="light"]')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu(page)).toBeHidden()
  await expect(btn(page)).toBeFocused()
  await expectInStep(page, 'light', 'light')

  await page.keyboard.press(' ')
  await expect(menu(page).locator('[data-theme-mode="light"]')).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu(page).locator('[data-theme-mode="contrast"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  await expect(btn(page)).toBeFocused()
  await expect(btn(page)).toHaveAttribute('aria-expanded', 'false')
  await expectInStep(page, 'light', 'light')

  await page.keyboard.press('ArrowUp')
  await expect(menu(page).locator('[data-theme-mode="contrast"]')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(menu(page)).toBeHidden()
  await btn(page).click()
  await page.mouse.click(700, 500)
  await expect(menu(page)).toBeHidden()
})

test('Shift+Tab or Tab out of the open menu closes it, and Escape then still reaches the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openOs(page, 'dark')
  await load(page)
  await btn(page).focus()
  await page.keyboard.press('Enter')
  await expect(menu(page).locator('[data-theme-mode="auto"]')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(btn(page)).toBeFocused()
  await expect(menu(page)).toBeHidden()
  await expect(btn(page)).toHaveAttribute('aria-expanded', 'false')
  // A press on the button opens it again.
  await page.keyboard.press('Enter')
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(menu(page)).toBeHidden()
  // A click on the button while open closes it, and the next one opens it.
  await btn(page).click()
  await expect(menu(page)).toBeVisible()
  await btn(page).click()
  await expect(menu(page)).toBeHidden()
  await btn(page).click()
  await expect(menu(page)).toBeVisible()
})

test('with the side panel open, Escape closes the theme menu only, then the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openOs(page, 'dark')
  await load(page)
  await page.locator('button.msg-open').first().click()
  await expect(page.locator('#inspector')).toBeVisible()
  await btn(page).click()
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  await expect(btn(page)).toBeFocused()
  await expect(page.locator('#inspector')).toBeVisible()
  // Focus on the button with the menu open (a pointer press that Safari does not focus, say).
  await btn(page).click()
  await btn(page).focus()
  await expect(menu(page)).toBeHidden()
  await btn(page).click()
  await menu(page).locator('[data-theme-mode="light"]').focus()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  await expect(page.locator('#inspector')).toBeVisible()
  // With the menu closed, Escape is the page's again.
  await page.keyboard.press('Escape')
  await expect(page.locator('#inspector')).toBeHidden()
})

test('in the menu a letter moves to the mode it starts (A, L, D, H) without choosing it', async ({ page }) => {
  await openOs(page, 'dark')
  await load(page)
  await btn(page).focus()
  await page.keyboard.press('Enter')
  for (const [letter, mode] of [
    ['h', 'contrast'],
    ['L', 'light'],
    ['d', 'dark'],
    ['a', 'auto'],
    ['x', 'auto'],
  ] as const) {
    await page.keyboard.press(letter)
    await expect(menu(page).locator(`[data-theme-mode="${mode}"]`)).toBeFocused()
  }
  await expectInStep(page, 'auto', 'dark')
  await expect(menu(page)).toBeVisible()
})

test('hover tints an item but the focus ring stays on the focused one; the light menu edge is 3:1', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openOs(page, 'light')
  await load(page)
  await btn(page).focus()
  await page.keyboard.press('Enter')
  await menu(page).locator('[data-theme-mode="dark"]').hover()
  const ring = (mode: Mode) =>
    menu(page)
      .locator(`[data-theme-mode="${mode}"]`)
      .evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(await ring('auto')).toBe('solid')
  expect(await ring('dark')).toBe('none')
  // sRGB from any CSS colour, through a canvas, then the WCAG ratio of the border to the top bar.
  const ratio = await page.evaluate(() => {
    const rgb = (css: string) => {
      const c = document.createElement('canvas').getContext('2d')!
      c.fillStyle = css
      c.fillRect(0, 0, 1, 1)
      return Array.from(c.getImageData(0, 0, 1, 1).data.slice(0, 3))
    }
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const edge = lum(rgb(getComputedStyle(document.querySelector('#theme-menu')!).borderTopColor))
    // The top bar is see-through over the page; on white it is lightest, the hardest case.
    const bar = lum(rgb('#fff'))
    return (Math.max(edge, bar) + 0.05) / (Math.min(edge, bar) + 0.05)
  })
  expect(ratio).toBeGreaterThanOrEqual(3)
})

test('axe finds nothing serious with the menu open or closed, in every theme and forced colours', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openOs(page, 'dark')
  await load(page)
  for (const mode of ['auto', 'light', 'dark', 'contrast'] as const) {
    await choose(page, mode)
    for (const open of [false, true]) {
      if (open) await btn(page).click()
      const violations = await seriousViolations(page)
      expect(violations, `${mode}, menu ${open ? 'open' : 'closed'}: ${formatViolations(violations)}`).toEqual([])
      if (open) await page.keyboard.press('Escape')
    }
  }
  // Forced colours: axe on the control itself (author colours elsewhere on the page are not in
  // play then, and axe still reads them), and the menu keeps a system border and text colour.
  await page.emulateMedia({ forcedColors: 'active' })
  await btn(page).click()
  const control = await new AxeBuilder({ page })
    .include('.theme-control')
    .withTags([...AXE_TAGS])
    .analyze()
  const serious = control.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious, formatViolations(serious)).toEqual([])
  const look = await menu(page).evaluate((el) => {
    const s = getComputedStyle(el)
    return { border: s.borderTopStyle, item: getComputedStyle(el.querySelector('[aria-checked="true"]')!).color }
  })
  expect(look.border).toBe('solid')
  expect(look.item).not.toBe('rgba(0, 0, 0, 0)')
  await expect(menu(page).locator('[aria-checked="true"] .theme-menu-check')).toBeVisible()
})
