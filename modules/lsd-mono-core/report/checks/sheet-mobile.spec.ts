import { devices, expect, test, type CDPSession, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { openIndex, openReport, sectionsReport } from './diagram-pages'

/**
 * The Timing and metrics panel on a phone, swiped with real touch (CDP touch events, so the
 * browser runs its own gesture and scroll-chaining logic). The panel sits at the bottom of the
 * narrow layout. It must not trap the swipe: a swipe that starts on the panel scrolls the page,
 * both down to the end and back up past the panel, and the panel is not a scroll box of its own.
 */
const PHONES = {
  iPhone: devices['iPhone 13'],
  Pixel: devices['Pixel 7'],
} as const

/** One finger swipe from y0 to y1 at x, in CSS px, then a pause for the scroll to settle. */
async function swipe(page: Page, cdp: CDPSession, x: number, y0: number, y1: number): Promise<void> {
  const steps = 12
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(300)
}

/** The sections fixture with timed calls and metrics, so the panel holds a long Timing view. */
function timedReport(): Report {
  const report = sectionsReport(30)
  const scenario = report.scenarios[0]
  scenario.metrics = [
    { key: 'Messages', value: '90' },
    { key: 'Captured duration', value: '4,095 ms' },
  ]
  scenario.events = scenario.events.map((e, i) => (e.kind === 'message' ? { ...e, durationMs: 5 + i } : e))
  return report
}

function state(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.inspector')!
    const r = panel.getBoundingClientRect()
    return {
      pageY: Math.round(scrollY),
      pageMax: document.documentElement.scrollHeight - innerHeight,
      panelTop: Math.round(r.top),
      panelBottom: Math.round(r.bottom),
      panelScrolled: Math.round(panel.scrollTop),
      panelScrollRange: panel.scrollHeight - panel.clientHeight,
    }
  })
}

for (const [phone, device] of Object.entries(PHONES)) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = device
  const context = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }
  for (const [pageName, open] of Object.entries({ report: openReport, index: openIndex })) {
    test.describe(`timing and metrics panel on ${phone}, ${pageName} page`, () => {
      test.use(context)

      test('a swipe on the open panel scrolls the page, down to the end and back up', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await open(page, timedReport())
        await expect(page.locator('.seq-svg')).toBeVisible()
        await page.locator('[data-show-metrics]').first().tap()
        const panel = page.locator('.inspector')
        await expect(panel).toBeVisible()
        await expect(panel.getByRole('heading', { level: 2 })).toBeVisible()
        await panel.scrollIntoViewIfNeeded()
        const cdp = await page.context().newCDPSession(page)
        const x = Math.round(viewport.width / 2)
        const low = viewport.height - 60
        const high = 120

        const before = await state(page)
        expect(before.panelScrollRange, 'the panel is part of the page, not a second scroll box').toBeLessThanOrEqual(1)
        expect(before.panelTop).toBeLessThan(low)

        // Up-swipes that start on the panel move the page until its end.
        await swipe(page, cdp, x, Math.max(before.panelTop + 20, low), high)
        const once = await state(page)
        expect(once.pageY, 'the first swipe on the panel moves the page').toBeGreaterThan(before.pageY + 100)
        for (let i = 0; i < 12 && (await state(page)).pageY < once.pageMax - 1; i++)
          await swipe(page, cdp, x, low, high)
        const end = await state(page)
        expect(end.pageY).toBeGreaterThanOrEqual(end.pageMax - 1)
        expect(end.panelScrolled).toBe(0)

        // Down-swipes on the panel bring the page back above the panel.
        for (let i = 0; i < 12 && (await state(page)).panelTop < viewport.height; i++) {
          await swipe(page, cdp, x, high, low)
        }
        const back = await state(page)
        expect(back.panelTop, 'the page scrolled back up past the panel').toBeGreaterThanOrEqual(viewport.height)
      })
    })
  }
}

test('desktop keeps the side panel as its own scroll column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, timedReport())
  await page.locator('[data-show-metrics]').first().click()
  const panel = page.locator('.inspector')
  await expect(panel).toBeVisible()
  const style = await panel.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { position: cs.position, overflowY: cs.overflowY, scrolls: el.scrollHeight > el.clientHeight }
  })
  expect(style).toEqual({ position: 'sticky', overflowY: 'auto', scrolls: true })
})
