import { expect, test, type Page } from '@playwright/test'
import { wideReport } from './wide-sample'
import { openReport } from './open-report'

// #65: the "More lanes →" cue on a wide diagram is a button that scrolls one screen right, so a
// click on it no longer falls through to the arrow underneath, and a screen reader hears it.
// Shift+←/→ scroll a screen from the keyboard, Home and End go to the edges.

async function openWide(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 800 })
  await openReport(page, { report: wideReport(100, 400) })
}

const scrollLeft = (page: Page) => page.locator('.seq-scroll').evaluate((el) => el.scrollLeft)

for (const width of [1280, 390]) {
  test(`at ${width}px the More lanes cue is a button that scrolls right and opens nothing`, async ({ page }) => {
    await openWide(page, width)
    const cue = page.getByRole('button', { name: 'More lanes to the right: scroll right' })
    await expect(cue).toBeVisible()
    await expect(cue).toContainText('More lanes')
    if (process.env.LSD_SHOTS) await page.screenshot({ path: `${process.env.LSD_SHOTS}/q-65-more-lanes-${width}.png` })
    expect(await scrollLeft(page)).toBe(0)
    await cue.click()
    await expect.poll(() => scrollLeft(page)).toBeGreaterThan(width / 2)
    await expect(page.locator('#inspector')).toBeHidden()
  })
}

test('pressing More lanes until the right edge leaves focus on the diagram, not the page', async ({ page }) => {
  await openWide(page, 1280)
  const cue = page.getByRole('button', { name: 'More lanes to the right: scroll right' })
  // Half a screen from the right edge, so one press reaches it.
  await page.locator('.seq-scroll').evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth * 1.5
  })
  await cue.click()
  await expect(cue).toBeHidden()
  await expect(page.locator('.seq-scroll')).toBeFocused()
})

test('Shift+arrows scroll the diagram a screen sideways, Home and End go to its edges', async ({ page }) => {
  await openWide(page, 1280)
  await page.locator('.seq-scroll').focus()
  const port = await page
    .locator('.seq-scroll')
    .evaluate((el) => ({ width: el.clientWidth, max: el.scrollWidth - el.clientWidth }))
  await page.keyboard.press('Shift+ArrowRight')
  expect(await scrollLeft(page)).toBe(port.width - 48)
  await page.keyboard.press('End')
  expect(await scrollLeft(page)).toBe(port.max)
  await expect(page.getByRole('button', { name: 'More lanes to the right: scroll right' })).toBeHidden()
  await page.keyboard.press('Shift+ArrowLeft')
  expect(await scrollLeft(page)).toBe(port.max - (port.width - 48))
  await page.keyboard.press('Home')
  expect(await scrollLeft(page)).toBe(0)
  // At the left edge already, Home is the page's again.
  await page.evaluate(() => window.scrollTo(0, 400))
  await page.keyboard.press('Home')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
})
