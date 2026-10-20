import { devices, expect, test, type CDPSession, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { PAGES, sectionsReport } from './diagram-pages'
import { openReport } from './open-report'

/**
 * The Timing and metrics panel on a phone, swiped with real touch (CDP touch events, so the
 * browser runs its own gesture and scroll-chaining logic). The panel sits at the bottom of the
 * narrow layout. It must not trap the swipe: a swipe that starts on the panel scrolls the page,
 * both down to the end and back up past the panel, and the panel is not a scroll box of its own.
 */
const PHONES = {
  iPhone: devices['iPhone 13'],
  // The same Chromium on both, so CI runs the matrix on one phone and a local run on both (#97).
  ...(process.env.CI ? {} : { Pixel: devices['Pixel 7'] }),
}

/** Resolves on the browser's next frame, so each touch move lands in a frame of its own. */
const nextFrame = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))

/**
 * One finger swipe from y0 to y1 at x, in CSS px. It returns when the finger lifts: the page may
 * still be flinging, so the checks poll scrollY instead of sleeping for the scroll to settle (#97).
 */
async function swipe(page: Page, cdp: CDPSession, x: number, y0: number, y1: number): Promise<void> {
  const steps = 6
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
  // Each move resolves once the browser has handled it, so no pause is needed between them.
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await nextFrame(page)
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

/** The sections fixture with one long, wide payload (call 1.2): tall and wider than a phone. */
function payloadReport(): Report {
  const report = timedReport()
  const scenario = report.scenarios[0]
  const wide = 'x'.repeat(160)
  const data = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field${i}`, i % 5 === 0 ? wide : i]))
  scenario.events = scenario.events.map((e) => (e.kind === 'message' && e.id === 'm1-2' ? { ...e, data } : e))
  return report
}

/** Elements in the panel that scroll on their own vertically, with their range. Empty is right. */
function verticalScrollBoxes(page: Page) {
  return page.evaluate(() =>
    [document.querySelector('.inspector')!, ...document.querySelectorAll('.inspector *')]
      .filter((el) => {
        const cs = getComputedStyle(el)
        return (
          el.getClientRects().length > 0 && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1
        )
      })
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} ${el.scrollHeight - el.clientHeight}px`),
  )
}

/** The Close button sits below the top bar and inside the screen. */
function closeInReach(page: Page) {
  return page.evaluate(() => {
    const close = [...document.querySelectorAll<HTMLElement>('.inspector-head button')].find((b) =>
      /close/i.test(b.textContent ?? ''),
    )
    const bar = document.querySelector('.topbar')!.getBoundingClientRect()
    if (!close) return 'no close button'
    const r = close.getBoundingClientRect()
    return r.top >= bar.bottom - 1 && r.bottom <= innerHeight
      ? 'in reach'
      : `close at ${Math.round(r.top)}, top bar ends ${Math.round(bar.bottom)}`
  })
}

function pageWidth(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
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
  for (const [pageName, open] of Object.entries(PAGES)) {
    test.describe(`timing and metrics panel on ${phone}, ${pageName} page`, () => {
      test.use(context)

      test('a swipe on the open panel scrolls the page, down to the end and back up', async ({ page }) => {
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
        await expect
          .poll(async () => (await state(page)).pageY, { message: 'the first swipe on the panel moves the page' })
          .toBeGreaterThan(before.pageY + 100)
        const toEnd = async () => {
          const now = await state(page)
          return now.pageMax - now.pageY
        }
        for (let i = 0; i < 12 && (await toEnd()) > 1; i++) await swipe(page, cdp, x, low, high)
        await expect.poll(toEnd, { message: 'the page reached its end' }).toBeLessThanOrEqual(1)
        expect((await state(page)).panelScrolled).toBe(0)

        // Down-swipes on the panel bring the page back above the panel.
        for (let i = 0; i < 12 && (await state(page)).panelTop < viewport.height; i++) {
          await swipe(page, cdp, x, high, low)
        }
        await expect
          .poll(async () => (await state(page)).panelTop, { message: 'the page scrolled back up past the panel' })
          .toBeGreaterThanOrEqual(viewport.height)
      })

      test('the Components view: swipes on it scroll the page, a tap opens a link, Close stays in reach', async ({
        page,
      }) => {
        await open(page, timedReport())
        await expect(page.locator('.seq-svg')).toBeVisible()
        await page.getByRole('tab', { name: 'Components' }).tap()
        const graph = page.locator('.comp-scroll')
        await expect(graph.locator('.component-diagram')).toBeVisible()
        expect(await verticalScrollBoxes(page)).toEqual([])
        expect(await pageWidth(page), 'nothing widens the page').toBeLessThanOrEqual(0)
        const cdp = await page.context().newCDPSession(page)
        const x = Math.round(viewport.width / 2)
        await graph.scrollIntoViewIfNeeded()
        await page.evaluate(() => scrollBy(0, -150))
        const box = (await graph.boundingBox())!
        const before = await state(page)
        // A swipe that starts on the drawing, carried well past its top (this drawing is short).
        const from = Math.min(box.y + box.height - 10, viewport.height - 40)
        await swipe(page, cdp, x, from, Math.max(from - 300, 60))
        await expect
          .poll(async () => (await state(page)).pageY, { message: 'a swipe on the drawing scrolls the page' })
          .toBeGreaterThan(before.pageY + 50)
        const edge = graph.locator('.edge-group').first()
        await edge.scrollIntoViewIfNeeded()
        const hit = (await edge.locator('.edge-hit').boundingBox())!
        await page.touchscreen.tap(hit.x + hit.width / 2, hit.y + hit.height / 2)
        await expect(graph.locator('.edge-group.is-selected')).toHaveCount(1)
        await expect(page.locator('.inspector #inspector-link .component-links')).toBeVisible()
        expect(await closeInReach(page)).toBe('in reach')
      })

      const openers = {
        'a component link': async (page: Page) => {
          await page.getByRole('tab', { name: 'Components' }).tap()
          await page.locator('.comp-scroll .edge-hit').first().dispatchEvent('click')
        },
        metrics: (page: Page) => page.locator('[data-show-metrics]').first().tap(),
      }
      for (const [what, body] of [
        ['a component link', '#inspector-link'],
        ['metrics', '#inspector-metrics'],
      ] as const) {
        test(`opening the ${what} scrolls its heading just below the top bar`, async ({ page }) => {
          await open(page, timedReport())
          await expect(page.locator('.seq-svg')).toBeVisible()
          await openers[what](page)
          await expect(page.locator('.inspector').locator(body)).toBeVisible()
          await expect
            .poll(() =>
              page.evaluate(() => {
                const bar = document.querySelector('.topbar')!.getBoundingClientRect().bottom
                const head = document.querySelector('.inspector h2')!.getBoundingClientRect()
                return head.top >= bar - 1 && head.bottom <= innerHeight
              }),
            )
            .toBe(true)
        })
      }

      for (const reducedMotion of ['reduce', 'no-preference'] as const) {
        test(`tapping an arrow low on the screen scrolls its JSON into view below the top bar (${reducedMotion})`, async ({
          page,
        }) => {
          await open(page, payloadReport(), { media: { reducedMotion } })
          await expect(page.locator('.seq-svg')).toBeVisible()
          const arrow = page.locator('.msg-open[aria-label^="Open call 1.2,"]')
          await expect(page.locator('.msg-payload')).not.toHaveCount(0)
          await arrow.tap()
          const pre = page.locator('.inspector pre').first()
          await expect(pre).toContainText('field0')
          await expect
            .poll(() =>
              pre.evaluate((el) => {
                const bar = document.querySelector('.topbar')!.getBoundingClientRect().bottom
                const top = el.getBoundingClientRect().top
                return top >= bar - 1 && top + 60 <= innerHeight
              }),
            )
            .toBe(true)
        })
      }

      test('a long, wide JSON payload: the page scrolls through it, lines wrap, no dead Expand, Close stays in reach', async ({
        page,
      }) => {
        await open(page, payloadReport())
        await expect(page.locator('.seq-svg')).toBeVisible()
        await page.locator('.msg-open[aria-label^="Open call 1.2,"]').tap()
        const panel = page.locator('.inspector')
        const pre = panel.locator('pre').first()
        await expect(pre).toContainText('field79')
        // The panel is already full width: no Expand control that cannot widen it; long lines wrap.
        await expect(panel.locator('#inspector-json-expand')).toBeHidden()
        expect(await verticalScrollBoxes(page), 'no part of the panel is a second vertical scroll box').toEqual([])
        expect(await pageWidth(page), 'the payload does not widen the page').toBeLessThanOrEqual(0)
        expect(await pre.evaluate((el) => el.scrollWidth - el.clientWidth), 'long lines wrap').toBeLessThanOrEqual(0)
        const cdp = await page.context().newCDPSession(page)
        const x = Math.round(viewport.width / 2)
        await pre.scrollIntoViewIfNeeded()
        const before = await state(page)
        await swipe(page, cdp, x, viewport.height - 60, 140)
        await expect
          .poll(async () => (await state(page)).pageY, { message: 'a swipe on the payload scrolls the page' })
          .toBeGreaterThan(before.pageY + 100)
        expect(await closeInReach(page)).toBe('in reach')
      })
    })
  }
}

test('desktop keeps the side panel as its own scroll column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: timedReport() })
  await page.locator('[data-show-metrics]').first().click()
  const panel = page.locator('.inspector')
  await expect(panel).toBeVisible()
  const style = await panel.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { position: cs.position, overflowY: cs.overflowY, scrolls: el.scrollHeight > el.clientHeight }
  })
  expect(style).toEqual({ position: 'sticky', overflowY: 'auto', scrolls: true })
})
