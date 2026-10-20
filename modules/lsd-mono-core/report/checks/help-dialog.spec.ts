import { devices, expect, test, type Page } from '@playwright/test'
import { openExample } from './example-report'
import { formatViolations, seriousViolations, THEMES } from './ux-helpers'
import { openReport } from './open-report'
import { example } from './example-report'

// The keyboard help (#112): a non-modal "Keyboard shortcuts" dialog with a close button that is in
// reach at every width, closed by ×, Esc, ? or a press outside, and a bottom sheet on phones.

const shots = process.env.LSD_SHOTS
const help = (page: Page) => page.locator('#help')
const helpButton = (page: Page) => page.locator('#btn-help')
const closeButton = (page: Page) => page.getByRole('button', { name: 'Close keyboard help' })

async function openHelp(page: Page): Promise<void> {
  await helpButton(page).click()
  await expect(help(page)).toHaveAttribute('data-open', 'true')
}

/** The close button is fully on screen and at least [min] px square. */
async function expectCloseInReach(page: Page, min: number): Promise<void> {
  const box = (await closeButton(page).boundingBox())!
  const view = page.viewportSize()!
  expect(box.width).toBeGreaterThanOrEqual(min)
  expect(box.height).toBeGreaterThanOrEqual(min)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(view.width)
  expect(box.y + box.height).toBeLessThanOrEqual(view.height)
}

test.describe('at 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('is a non-modal dialog named Keyboard shortcuts, and ? says whether it is open', async ({ page }) => {
    await openExample(page)
    await expect(helpButton(page)).toHaveAttribute('aria-controls', 'help')
    await expect(helpButton(page)).toHaveAttribute('aria-expanded', 'false')
    await openHelp(page)
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toHaveAttribute('aria-modal', 'true')
    await expect(helpButton(page)).toHaveAttribute('aria-expanded', 'true')
    await expectCloseInReach(page, 24)
    if (shots) await page.screenshot({ path: `${shots}/help-1440-open.png` })
  })

  test('moves focus to its close button, Tab reaches the setting, and × gives focus back to ?', async ({ page }) => {
    await openExample(page)
    await openHelp(page)
    await expect(closeButton(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('checkbox', { name: /Single-key shortcuts/ })).toBeFocused()
    await closeButton(page).click()
    await expect(help(page)).toHaveAttribute('data-open', 'false')
    await expect(helpButton(page)).toBeFocused()
    await expect(helpButton(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('closes on a click outside it, and ? still toggles it', async ({ page }) => {
    await openExample(page)
    await openHelp(page)
    await page.locator('#scenario-title').click()
    await expect(help(page)).toHaveAttribute('data-open', 'false')
    await openHelp(page)
    await helpButton(page).click()
    await expect(help(page)).toHaveAttribute('data-open', 'false')
  })

  test('Esc closes it and gives focus back to ?, and with the side panel open closes the help first', async ({
    page,
  }) => {
    await openExample(page)
    await openHelp(page)
    await page.keyboard.press('Escape')
    await expect(help(page)).toHaveAttribute('data-open', 'false')
    await expect(helpButton(page)).toBeFocused()
    await page.locator('.scenario-card button.msg-open').first().click()
    await expect(page.locator('#inspector')).toBeVisible()
    await openHelp(page)
    await page.keyboard.press('Escape')
    await expect(help(page)).toHaveAttribute('data-open', 'false')
    await expect(page.locator('#inspector')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#inspector')).toBeHidden()
  })

  for (const theme of THEMES) {
    test(`axe finds nothing serious with the help open, ${theme}`, async ({ page }) => {
      await openReport(page, { report: example, theme })
      await openHelp(page)
      const violations = await seriousViolations(page)
      expect(violations, formatViolations(violations)).toEqual([])
    })
  }

  test('? opens it from a diagram arrow and from the side panel, and Esc gives focus back there', async ({ page }) => {
    await openExample(page)
    const arrow = page.locator('.scenario-card button.msg-open').first()
    await arrow.focus()
    await page.keyboard.press('?')
    await expect(help(page)).toHaveAttribute('data-open', 'true')
    await expect(closeButton(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(help(page)).toHaveAttribute('data-open', 'false')
    await expect(arrow).toBeFocused()

    // In the side panel: the help opens over it, and Esc closes only the help.
    await page.keyboard.press('Enter')
    await expect(page.locator('#inspector')).toBeVisible()
    await page.locator('#inspector-close').focus()
    await page.keyboard.press('?')
    await expect(help(page)).toHaveAttribute('data-open', 'true')
    await page.keyboard.press('Escape')
    await expect(help(page)).toHaveAttribute('data-open', 'false')
    await expect(page.locator('#inspector')).toBeVisible()
    await expect(page.locator('#inspector-close')).toBeFocused()
  })

  test('? types in a text field and leaves an open menu alone', async ({ page }) => {
    await openExample(page)
    const find = page.locator('.scenario-card [data-diagram-find]').first()
    await find.focus()
    await page.keyboard.press('?')
    await expect(find).toHaveValue('?')
    await expect(help(page)).toHaveAttribute('data-open', 'false')
    await page.locator('#btn-theme').click()
    await expect(page.locator('#theme-menu')).toBeVisible()
    await page.locator('#theme-menu [role="menuitemradio"]').first().focus()
    await page.keyboard.press('?')
    await expect(help(page)).toHaveAttribute('data-open', 'false')
    await expect(page.locator('#theme-menu')).toBeVisible()
  })

  test('comes right after ? in the tab order: Shift+Tab from × goes to ?, Tab from the setting goes on to the sidebar', async ({
    page,
  }) => {
    await openExample(page)
    // After the top bar, whose last control is ?, in the DOM (inside it, the bar's backdrop filter
    // would make it the box the fixed dialog is placed in).
    expect(
      await page.evaluate(() => {
        const bar = document.querySelector('header.topbar')!
        const controls = [...bar.querySelectorAll('button, a, input, [tabindex]')]
        return { next: bar.nextElementSibling?.id, last: controls[controls.length - 1]?.id }
      }),
    ).toEqual({ next: 'help', last: 'btn-help' })
    await openHelp(page)
    await expect(closeButton(page)).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(helpButton(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(closeButton(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('checkbox', { name: /Single-key shortcuts/ })).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#sidebar')))).toBe(true)
  })

  test('in forced colours the panel border and the close button are drawn', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await openExample(page)
    await openHelp(page)
    for (const target of [help(page), closeButton(page)]) {
      const border = await target.evaluate((el) => {
        const style = getComputedStyle(el)
        return { style: style.borderTopStyle, width: style.borderTopWidth, colour: style.borderTopColor }
      })
      expect(border.style).toBe('solid')
      expect(border.width).not.toBe('0px')
      expect(border.colour).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    }
  })
})

for (const [name, size] of [
  ['iPhone 13', 390],
  ['iPhone SE', 320],
] as const) {
  test.describe(`on a ${size}px phone`, () => {
    const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices[name]
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('is a bottom sheet with a 44px close button on screen, and a tap outside closes it', async ({ page }) => {
      await openExample(page)
      await helpButton(page).tap()
      await expect(help(page)).toHaveAttribute('data-open', 'true')
      await expectCloseInReach(page, 44)
      const box = (await help(page).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 16 - 1)
      expect(box.height).toBeLessThanOrEqual(viewport.height * 0.7 + 1)
      if (shots) await page.screenshot({ path: `${shots}/help-${size}-open.png` })
      await page.locator('#scenario-title').tap()
      await expect(help(page)).toHaveAttribute('data-open', 'false')
    })

    test('can be closed with one tap after the page scrolls 600px', async ({ page }) => {
      await openExample(page)
      await helpButton(page).tap()
      await page.evaluate(() => window.scrollBy(0, 600))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
      if (shots) await page.screenshot({ path: `${shots}/help-${size}-open-scrolled.png` })
      await expectCloseInReach(page, 44)
      await closeButton(page).tap()
      await expect(help(page)).toHaveAttribute('data-open', 'false')
    })

    test('clips no text or key, and scrolls inside itself when taller than 70% of the screen', async ({ page }) => {
      await openExample(page)
      await helpButton(page).tap()
      const fit = await help(page).evaluate((panel) => {
        const box = panel.getBoundingClientRect()
        const clipped = [...panel.querySelectorAll('kbd, .help-setting-text, .help-keys, .help-title')].filter((el) => {
          const r = el.getBoundingClientRect()
          return r.left < box.left - 0.5 || r.right > box.right + 0.5
        })
        return {
          clipped: clipped.map((el) => el.textContent),
          sideways: panel.scrollWidth - panel.clientWidth,
          overflowY: getComputedStyle(panel).overflowY,
          maxHeight: parseFloat(getComputedStyle(panel).maxHeight),
          innerHeight: window.innerHeight,
        }
      })
      expect(fit.clipped).toEqual([])
      expect(fit.sideways).toBeLessThanOrEqual(0)
      expect(fit.overflowY).toBe('auto')
      expect(fit.maxHeight).toBeCloseTo(fit.innerHeight * 0.7, 0)
    })
  })
}
