import { expect, test, type Page } from '@playwright/test'
import { openExample } from './example-report'
import { openReport } from './open-report'
import { wideReport } from './wide-sample'

// #93: on a phone the More lanes cue covers nothing in the drawing. A slim tab marks the right
// edge in the participant header row only, the drawing keeps its full width below it, and More
// lanes → sits in the toolbar, while lanes remain there.
// Either one scrolls about a screen right and says which lanes are then in view.

const WIDTHS = [320, 390, 412]

const NAME = 'Show more lanes to the right'
const edgeTab = (page: Page) => page.locator('.seq-diagram .seq-edge-tab')
/** Width of the tab's painted part (its ::before), as opposed to its target. */
const visibleTabWidth = (page: Page) =>
  edgeTab(page).evaluate((el) => Number.parseFloat(getComputedStyle(el, '::before').width))
const status = (page: Page) => page.locator('.seq-diagram .participant-filter-status')
const toolbarButton = (page: Page) => page.locator('.seq-diagram .seq-toolbar .seq-more-lanes')
const scrollLeft = (page: Page) => page.locator('.seq-diagram .seq-scroll').evaluate((el) => el.scrollLeft)

/**
 * Text in the diagram (names, message labels with their durations and {} markers, band titles)
 * that a cue covers: what shows of it meets a cue's box, or a cue is what is hit at its middle.
 */
const coveredText = (page: Page) =>
  page.evaluate(() => {
    const diagram = document.querySelector('.seq-diagram')!
    const port = diagram.querySelector('.seq-scroll')!.getBoundingClientRect()
    // Below the sticky header: the tab sits on the header row, over the end of the last name
    // in view, and rows that slide under the header are hidden by it anyway.
    const headerBottom = diagram.querySelector('.seq-sticky-header')!.getBoundingClientRect().bottom
    const scroll = DOMRect.fromRect({
      x: port.x,
      y: headerBottom,
      width: port.width,
      height: port.bottom - headerBottom,
    })
    const cues = [...document.querySelectorAll('[data-more-lanes]')]
      .filter((el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => el.getBoundingClientRect())
    const texts = [...diagram.querySelectorAll('.seq-scroll text, .seq-scroll tspan')]
      .filter((el) => !el.closest('.seq-sticky-header'))
      .map((el) => ({
        text: el.textContent ?? '',
        box: el.getBoundingClientRect(),
      }))
    const seen = texts.filter(
      ({ box }) =>
        box.width > 0 &&
        box.right > scroll.left &&
        box.left < scroll.right &&
        box.bottom > scroll.top &&
        box.top < scroll.bottom,
    )
    const meets = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    // What shows of each text: the scrollport clips the rest.
    const shown = (box: DOMRect) =>
      DOMRect.fromRect({
        x: Math.max(box.left, scroll.left),
        y: Math.max(box.top, scroll.top),
        width: Math.min(box.right, scroll.right) - Math.max(box.left, scroll.left),
        height: Math.min(box.bottom, scroll.bottom) - Math.max(box.top, scroll.top),
      })
    const covered = seen.filter(({ box }) => {
      if (cues.some((cue) => meets(cue, shown(box)))) return true
      const x = Math.min(Math.max(box.left + box.width / 2, scroll.left + 1), scroll.right - 1)
      const hit = document.elementFromPoint(x, box.top + box.height / 2)
      return !!hit?.closest('[data-more-lanes]')
    })
    return { seen: seen.length, covered: covered.map(({ text }) => text) }
  })

/** How far down the screen the stage is once the toolbar has scrolled into view, before #120. */
const STAGE_AT: Record<number, number> = { 320: 542.5, 390: 524.75, 412: 524.75 }

for (const width of WIDTHS) {
  test(`at ${width} the edge tab and the toolbar button cover no text, and each scrolls right`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width, height: 760 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    })
    try {
      const page = await context.newPage()
      await openExample(page)
      await page.locator('.seq-diagram .seq-toolbar').scrollIntoViewIfNeeded()
      await expect(page.locator('.seq-diagram .seq-more')).toBeHidden()
      await expect(edgeTab(page)).toBeVisible()
      await expect(toolbarButton(page)).toBeVisible()
      await expect(toolbarButton(page)).toHaveText(/^More lanes\s→$/)
      await expect(toolbarButton(page)).toHaveAccessibleName(NAME)
      await expect(edgeTab(page)).toHaveAccessibleName(NAME)
      await expect(edgeTab(page)).toHaveRole('button')

      const tab = (await edgeTab(page).boundingBox())!
      const scroll = (await page.locator('.seq-diagram .seq-scroll').boundingBox())!
      // A touch screen: 44 px wide, and as tall as the header, no further.
      expect(tab.width).toBeGreaterThanOrEqual(44)
      expect(tab.height).toBeGreaterThanOrEqual(44)
      const header = (await page.locator('.seq-diagram .seq-sticky-header').boundingBox())!
      expect(tab.y).toBeGreaterThanOrEqual(header.y - 1)
      expect(tab.y + tab.height).toBeLessThanOrEqual(header.y + header.height + 1)
      // No gutter: the drawing has the stage's full width, and the tab sits on its right edge.
      const stage = (await page.locator('.seq-diagram .seq-stage').boundingBox())!
      expect(Math.abs(scroll.width - stage.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(tab.x + tab.width - (scroll.x + scroll.width))).toBeLessThanOrEqual(1)
      // What shows of it is slim; the rest of the 44 px target is transparent.
      expect(await visibleTabWidth(page)).toBeLessThanOrEqual(20)
      expect((await toolbarButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44)

      // The rows slide under the sticky header as the page scrolls: look at several places. They
      // are places in the drawing, so they start from where the stage is, not the toolbar: at 320
      // the toolbar has a row more since 1:1 (#120), which moves the drawing down the page. (The
      // tab does cover text at some other places at 320, before #120 too: an open question.)
      const top = await page.evaluate(
        (at) => document.querySelector('.seq-diagram .seq-stage')!.getBoundingClientRect().top + scrollY - at,
        STAGE_AT[width],
      )
      let looked = 0
      for (let step = 0; step < 8; step++) {
        await page.evaluate((y) => scrollTo(0, y), top + step * 90)
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
        const seen = await coveredText(page)
        looked += seen.seen
        expect(seen.covered, `step ${step}`).toEqual([])
      }
      // Some places show only gaps between rows below the header; all of them together show text.
      expect(looked).toBeGreaterThan(20)
      await page.evaluate((y) => scrollTo(0, y), top)

      const start = await scrollLeft(page)
      await edgeTab(page).tap()
      await expect.poll(() => scrollLeft(page)).toBeGreaterThan(start)
      const next = await scrollLeft(page)
      // About one screen, and the lanes now in view are said.
      expect(next - start).toBeGreaterThan(scroll.width * 0.5)
      await expect(status(page)).toHaveText(/^Lanes in view: \S/)
      expect((await coveredText(page)).covered).toEqual([])
      await toolbarButton(page).tap()
      await expect.poll(() => scrollLeft(page)).toBeGreaterThan(next)

      // At the right edge both go, and the drawing keeps its width, so it does not jump.
      const scrollWidth = await page.locator('.seq-diagram .seq-scroll').evaluate((el) => el.clientWidth)
      await page.locator('.seq-diagram .seq-scroll').evaluate((el) => {
        el.scrollLeft = el.scrollWidth
      })
      await expect(toolbarButton(page)).toBeHidden()
      await expect(edgeTab(page)).toBeHidden()
      expect(await page.locator('.seq-diagram .seq-scroll').evaluate((el) => el.clientWidth)).toBe(scrollWidth)
    } finally {
      await context.close()
    }
  })
}

test('at 320 with no metrics, More lanes has the Metrics row to itself, 44 px tall, inside the toolbar', async ({
  browser,
  baseURL,
}) => {
  const report = wideReport(12, 40)
  report.scenarios[0].metrics = []
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 760 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    await openReport(page, { report })
    await expect(page.locator('.seq-diagram .seq-toolbar .panel-controls')).toHaveCount(0)
    await expect(toolbarButton(page)).toBeVisible()
    const button = (await toolbarButton(page).boundingBox())!
    const bar = (await page.locator('.seq-diagram .seq-toolbar').boundingBox())!
    expect(button.height).toBeGreaterThanOrEqual(44)
    expect(button.x).toBeGreaterThanOrEqual(bar.x)
    expect(button.x + button.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5)
    expect((await coveredText(page)).covered).toEqual([])
  } finally {
    await context.close()
  }
})

test("with a fine pointer at 390 the edge tab is 24 px wide, over the drawing's full width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await openExample(page)
  await page.locator('.seq-diagram .seq-toolbar').scrollIntoViewIfNeeded()
  await expect(edgeTab(page)).toBeVisible()
  const tab = (await edgeTab(page).boundingBox())!
  const scroll = (await page.locator('.seq-diagram .seq-scroll').boundingBox())!
  const stage = (await page.locator('.seq-diagram .seq-stage').boundingBox())!
  expect(tab.width).toBe(24)
  expect(Math.abs(scroll.width - stage.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(tab.x + tab.width - (scroll.x + scroll.width))).toBeLessThanOrEqual(1)
  expect((await coveredText(page)).covered).toEqual([])
})

test('from the keyboard, More lanes → in the toolbar scrolls right, and focus stays on the diagram at the edge', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 760 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    await openExample(page)
    const button = toolbarButton(page)
    await button.focus()
    // One press at a time, each waited out: a press sent after focus moved would reach the diagram.
    const focused = () => button.evaluate((el) => el === document.activeElement)
    for (let i = 0; i < 40 && (await focused()); i++) {
      const before = await scrollLeft(page)
      await page.keyboard.press('Enter')
      await expect.poll(() => scrollLeft(page)).toBeGreaterThan(before)
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    }
    await expect(button).toBeHidden()
    await expect(page.locator('.seq-diagram .seq-scroll')).toBeFocused()
    await expect(status(page)).toHaveText(/^Last lanes in view: \S/)
  } finally {
    await context.close()
  }
})

test('at 1440 the pill stays, and the phone cues are not shown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page)
  await expect(page.locator('.seq-diagram .seq-more-btn')).toBeVisible()
  await expect(edgeTab(page)).toBeHidden()
  await expect(toolbarButton(page)).toBeHidden()
})
