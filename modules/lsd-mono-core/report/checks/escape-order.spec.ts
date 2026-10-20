import { expect, test, type Page } from '@playwright/test'
import { openExample } from './example-report'

// One Escape closes one thing, the innermost first (#102): an open menu or the keyboard help
// (#112), then the side panel, then Overview.

test.use({ viewport: { width: 1440, height: 900 } })

const card = (page: Page) => page.locator('.scenario-card').first()
const overview = (page: Page) => card(page).getByRole('button', { name: 'Overview', exact: true })
const panel = (page: Page) => page.locator('#inspector')
const arrow = (page: Page) => card(page).locator('button.msg-open').first()

async function panelInOverview(page: Page): Promise<void> {
  await openExample(page)
  await arrow(page).click()
  await expect(panel(page)).toBeVisible()
  await overview(page).click()
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
}

test('from the toolbar, Escape closes the side panel, then leaves Overview', async ({ page }) => {
  await panelInOverview(page)
  await expect(overview(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
})

test('from a message arrow, Escape closes the side panel, then leaves Overview', async ({ page }) => {
  await panelInOverview(page)
  await arrow(page).focus()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(arrow(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(panel(page)).toBeHidden()
})

test('with a participant menu and the side panel open in Overview, each Escape closes one', async ({ page }) => {
  await panelInOverview(page)
  const menu = page.locator('.participant-menu')
  await card(page).locator('[data-participant-head]').first().click({ button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(panel(page)).toBeVisible()
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
})

test('with the help and the side panel open, Escape closes the help, then the panel (#112)', async ({ page }) => {
  await openExample(page)
  await arrow(page).click()
  await expect(panel(page)).toBeVisible()
  await page.getByRole('button', { name: 'Show keyboard help' }).click()
  const help = page.locator('#help')
  await expect(help).toHaveAttribute('data-open', 'true')
  await page.keyboard.press('Escape')
  await expect(help).toHaveAttribute('data-open', 'false')
  await expect(panel(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
})

test('a held Escape closes only the first layer: the help, not the panel after it', async ({ page }) => {
  await openExample(page)
  await arrow(page).click()
  await expect(panel(page)).toBeVisible()
  await page.getByRole('button', { name: 'Show keyboard help' }).click()
  const help = page.locator('#help')
  await expect(help).toHaveAttribute('data-open', 'true')
  // A second keydown without a keyup is an auto-repeat.
  await page.keyboard.down('Escape')
  await page.keyboard.down('Escape')
  await page.keyboard.down('Escape')
  await page.keyboard.up('Escape')
  await expect(help).toHaveAttribute('data-open', 'false')
  await expect(panel(page)).toBeVisible()
})
