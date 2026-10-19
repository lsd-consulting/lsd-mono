import { expect, test } from '@playwright/test'

// WCAG 2.4.3 Focus Order: closing the Metrics panel returns focus to the control that opened it.
// The timing chips open Metrics too, so the toolbar button is not the only way in.

for (const closeWith of ['Escape', 'Close'] as const) {
  test(`closing Metrics with ${closeWith} returns focus to the toolbar button or the chip that opened it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.locator('.seq-svg')).toBeVisible()
    const close = async () => {
      if (closeWith === 'Escape') await page.keyboard.press('Escape')
      else await page.locator('#inspector').getByRole('button', { name: 'Close' }).click()
      await expect(page.locator('#inspector')).toBeHidden()
    }

    // From the toolbar button, which sits below the first timing chip.
    const toolbar = page.locator('.seq-toolbar [data-show-metrics]')
    await toolbar.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#inspector')).toBeVisible()
    await close()
    await expect(toolbar).toBeFocused()

    // From the third chip: back on that chip, not the first or the toolbar button.
    const chips = page.locator('.timing-chip')
    await chips.nth(2).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#inspector')).toBeVisible()
    await close()
    await expect(chips.nth(2)).toBeFocused()
  })
}
