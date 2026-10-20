import { expect, test, type Page } from '@playwright/test'
import { wideReport } from './wide-sample'
import { openReport } from './open-report'

// #65: on the 100-participant perf sample, the first view used to be Fit at 50% with tiny labels
// and mostly empty lanes. Fit now stops at 95% (#81), so the first rows' labels are readable on
// the first screen and a "More lanes →" cue says the rest lies to the right.

/** Message labels wholly inside the diagram's scrollport, below its sticky header, and on screen. */
function labelsInView(page: Page) {
  return page.evaluate(() => {
    const port = document.querySelector('.seq-scroll')!.getBoundingClientRect()
    const header = document.querySelector('.seq-sticky-header')!.getBoundingClientRect()
    const top = Math.max(port.top, header.bottom)
    const bottom = Math.min(port.bottom, window.innerHeight)
    return [...document.querySelectorAll<SVGTextElement>('.seq-svg .msg-label')].filter((text) => {
      const box = text.getBoundingClientRect()
      return (
        box.width > 0 &&
        box.left >= port.left - 1 &&
        box.right <= port.right + 1 &&
        box.top >= top - 1 &&
        box.bottom <= bottom + 1
      )
    }).length
  })
}

test('the 100-participant sample opens at 1280px with message labels in view and the more-lanes cue', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: wideReport(100, 400) })
  await expect(page.locator('.zoom-readout')).toHaveText('95%')

  // Above the fold, under the scenario header.
  await expect.poll(() => labelsInView(page)).toBeGreaterThanOrEqual(3)
  await expect(page.locator('.seq-more span')).toBeVisible()
  await expect(page.locator('.seq-more span')).toContainText('More lanes')
  // The first view starts at the left edge with the top label; nothing scrolls or animates on open.
  expect(await page.locator('.seq-scroll').evaluate((el) => el.scrollLeft)).toBe(0)
  await page.screenshot({
    path: process.env.LSD_SHOTS ? `${process.env.LSD_SHOTS}/q-65-100p-1280-first-screen.png` : undefined,
  })

  // With the diagram scrolled up to fill the screen, labels are still in view, not just lanes.
  await page.locator('.seq-scroll').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await expect.poll(() => labelsInView(page)).toBeGreaterThanOrEqual(3)
  await page.screenshot({
    path: process.env.LSD_SHOTS ? `${process.env.LSD_SHOTS}/q-65-100p-1280-diagram.png` : undefined,
  })
})

// #62: one set of header buttons, moved to the header in use, keeps the 100-participant header
// near its 535 nodes from before the participant filter (1,536 with buttons on every header).
test('the 100-participant header has one set of Hide and More buttons, which follows the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: wideReport(100, 400) })
  const header = page.locator('.seq-sticky-header')
  expect(await header.evaluate((el) => el.getElementsByTagName('*').length)).toBeLessThanOrEqual(700)
  await expect(header.locator('.participant-heads button')).toHaveCount(2)
  await header.locator('[data-participant-head="p03"]').hover()
  await expect(page.getByRole('button', { name: 'Hide Queue 03', exact: true })).toBeVisible()
  await expect(header.locator('.participant-heads button')).toHaveCount(2)
})

test('moving along the header from the keyboard keeps the focused button inside the diagram (#62)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: wideReport(100, 400) })
  await page.locator('.participant-heads [data-hide-participant]').focus()
  await expect(page.locator('.participant-heads button:focus')).toHaveCount(1)
  const inside = () =>
    page.evaluate(() => {
      const port = document.querySelector('.seq-scroll')!.getBoundingClientRect()
      const box = document.activeElement!.getBoundingClientRect()
      return {
        label: document.activeElement!.getAttribute('aria-label'),
        in: box.left >= port.left - 1 && box.right <= port.right + 1,
      }
    })
  for (const key of ['End', 'ArrowRight', 'Home', 'ArrowLeft']) {
    await page.keyboard.press(key)
    expect(await inside(), key).toMatchObject({ in: true })
  }
})
