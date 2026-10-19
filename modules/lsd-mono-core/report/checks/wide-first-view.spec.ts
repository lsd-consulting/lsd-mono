import { expect, test, type Page } from '@playwright/test'
import { wideReport } from './wide-sample'

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
  await page.addInitScript(
    (report) => {
      window.__LSD_REPORT__ = report
    },
    wideReport(100, 400),
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
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
