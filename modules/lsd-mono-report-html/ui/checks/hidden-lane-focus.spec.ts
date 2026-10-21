import { expect, test } from '@playwright/test'
import { openReport } from './open-report'
import { wideReport } from './wide-sample'

// WCAG 2.4.3 Focus Order: when the side panel closes on a message whose lane was hidden while it
// was open, focus goes to the nearest arrow still drawn rather than to the page.
// In wideReport(4, 8), message 1 runs p01→p02, 2 p02→p04, 3 p03→p02 and 4 p04→p01.

test('closing the panel on a message whose lane was hidden focuses the next drawn arrow', async ({ page }) => {
  await openReport(page, { report: wideReport(4, 8, () => ({ ok: true })), viewport: { width: 1440, height: 900 } })
  const arrow = (id: string) => page.locator(`.seq-scroll button.msg-open[data-message-id="${id}"]`)
  await arrow('1').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#inspector')).toBeVisible()

  const head = page.locator('.participant-heads [data-participant-head="p02"]')
  await head.hover()
  await head.locator('[data-hide-participant="p02"]').click()
  await expect(arrow('1')).toHaveCount(0)
  await expect(page.locator('#inspector')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('#inspector')).toBeHidden()
  await expect(arrow('4')).toBeFocused()
})
