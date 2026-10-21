import { devices, expect, test, type Page } from '@playwright/test'
import { openExample } from './example-report'

// #114: Escape in the page search or a diagram's Find. The first Escape clears the text (the
// scenario list or the Find matches reset) and keeps focus in the field; the next moves focus to
// the field's owner (search: the scenario heading, Find: the diagram's scrollport), never the
// body; after that the usual order (#102) goes on, so from Find the next Escape leaves Overview.

const { userAgent, deviceScaleFactor } = devices['iPhone 13']
const SIZES = {
  '1440': { viewport: { width: 1440, height: 900 } },
  '390 touch': { viewport: { width: 390, height: 844 }, userAgent, deviceScaleFactor, isMobile: true, hasTouch: true },
  '320 touch': { viewport: { width: 320, height: 568 }, userAgent, deviceScaleFactor, isMobile: true, hasTouch: true },
} as const

const card = (page: Page) => page.locator('.scenario-card').first()
const seq = (page: Page) => card(page).locator('.seq-diagram')
const find = (page: Page) => seq(page).locator('[data-diagram-find]')
const search = (page: Page) => page.locator('#search')
const overview = (page: Page) => seq(page).getByRole('button', { name: 'Overview', exact: true })
const readout = (page: Page) => seq(page).locator('.zoom-readout')
const navItems = (page: Page) => page.locator('#scenario-nav [data-nav]')
const hits = (page: Page) => seq(page).locator('[data-search-hit]')

/** What has focus: never the body. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'BODY'
    if (el.id) return `#${el.id}`
    return el.matches('[data-diagram-find]') ? 'find' : el.classList.contains('seq-scroll') ? 'scrollport' : el.tagName
  })

/** The focused element is fully on screen, below the sticky top bar. */
const focusOnScreen = (page: Page) =>
  page.evaluate(() => {
    const r = document.activeElement!.getBoundingClientRect()
    const bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
    // A tall scrollport only needs its top in view.
    const tall = r.height > innerHeight / 2
    return r.top >= Math.min(bar, r.top) - 1 && (tall ? r.top < innerHeight : r.bottom <= innerHeight + 1)
  })

/**
 * Watches the next keydown: the returned function then says whether the page's own handler took
 * it (defaultPrevented). Chromium empties a search field on Escape by itself, so the value alone
 * cannot tell the page's clear from the browser's.
 */
async function nextKeyTaken(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    const w = window as unknown as { keyTaken?: boolean }
    delete w.keyTaken
    document.addEventListener('keydown', (e) => (w.keyTaken = e.defaultPrevented), { once: true })
  })
  return () => page.evaluate(() => (window as unknown as { keyTaken?: boolean }).keyTaken === true)
}

/** The diagram's own scroll position, which leaving Overview puts back. */
const diagramScroll = (page: Page) =>
  seq(page)
    .locator('.seq-scroll')
    .evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }))

for (const [size, use] of Object.entries(SIZES)) {
  test.describe(`Escape in search and Find at ${size}`, () => {
    test.use(use)

    test('search: Esc clears the text and keeps focus, then goes to the scenario heading', async ({ page }) => {
      await openExample(page)
      const all = await navItems(page).count()
      await search(page).click()
      // "order" (the issue's word) is in every scenario of the example; "declined" is in one.
      await page.keyboard.type('declined')
      await expect(navItems(page)).toHaveCount(1)
      const taken = await nextKeyTaken(page)
      await page.keyboard.press('Escape')
      expect(await taken(), 'the page cleared it, not the browser').toBe(true)
      await expect(search(page)).toHaveValue('')
      await expect.poll(() => navItems(page).count()).toBe(all)
      expect(await focused(page)).toBe('#search')
      await page.keyboard.press('Escape')
      expect(await focused(page)).toBe('#scenario-title')
      expect(await focusOnScreen(page)).toBe(true)
      // Nothing else to close: focus stays put.
      await page.keyboard.press('Escape')
      expect(await focused(page)).toBe('#scenario-title')
    })

    test('Find: Esc clears the text and the matches, then goes to the diagram scrollport', async ({ page }) => {
      await openExample(page)
      await find(page).click()
      await page.keyboard.type('pay')
      await expect.poll(() => hits(page).count()).toBeGreaterThan(0)
      const taken = await nextKeyTaken(page)
      await page.keyboard.press('Escape')
      expect(await taken(), 'the page cleared it, not the browser').toBe(true)
      await expect(find(page)).toHaveValue('')
      await expect(hits(page)).toHaveCount(0)
      await expect(seq(page).locator('.diagram-find-count')).toHaveText('')
      expect(await focused(page)).toBe('find')
      await page.keyboard.press('Escape')
      expect(await focused(page)).toBe('scrollport')
      // Where focus went shows.
      const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)
      expect(ring).not.toBe('none')
      await page.keyboard.press('Escape')
      expect(await focused(page)).toBe('scrollport')
    })

    test('Overview, Find "pay", Esc ×3: clear, leave Find, leave Overview to the zoom and scroll from before', async ({
      page,
    }) => {
      await openExample(page)
      const zoom = await readout(page).innerText()
      const before = await diagramScroll(page)
      await overview(page).click()
      await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
      await find(page).click()
      await page.keyboard.type('pay')
      await expect.poll(() => hits(page).count()).toBeGreaterThan(0)

      await page.keyboard.press('Escape')
      await expect(find(page)).toHaveValue('')
      await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')
      expect(await focused(page)).toBe('find')

      await page.keyboard.press('Escape')
      expect(await focused(page)).toBe('scrollport')
      await expect(overview(page)).toHaveAttribute('aria-pressed', 'true')

      await page.keyboard.press('Escape')
      await expect(overview(page)).toHaveAttribute('aria-pressed', 'false')
      await expect(readout(page)).toHaveText(zoom)
      expect(await focused(page)).not.toBe('BODY')
      const after = await diagramScroll(page)
      expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(2)
      expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2)
    })

    test('with the side panel open, Esc in Find closes only the panel, and focus goes back to its message', async ({
      page,
    }) => {
      await openExample(page)
      const opener = card(page).locator('button.msg-open').first()
      await opener.click()
      await expect(page.locator('#inspector')).toBeVisible()
      await find(page).click()
      await page.keyboard.type('pay')
      await page.keyboard.press('Escape')
      await expect(page.locator('#inspector')).toBeHidden()
      await expect(find(page)).toHaveValue('pay')
      await expect(opener).toBeFocused()
    })

    test('with the side panel open, a held Esc in search closes the panel and leaves the text', async ({ page }) => {
      await openExample(page)
      const opener = card(page).locator('button.msg-open').first()
      await opener.click()
      await expect(page.locator('#inspector')).toBeVisible()
      await search(page).click()
      await page.keyboard.type('order')
      // Held: the first keydown closes the panel (focus back to its opener); the repeats clear nothing.
      await page.keyboard.down('Escape')
      await page.keyboard.down('Escape')
      await page.keyboard.down('Escape')
      await page.keyboard.up('Escape')
      await expect(page.locator('#inspector')).toBeHidden()
      await expect(search(page)).toHaveValue('order')
      await expect(navItems(page)).not.toHaveCount(0)
      await expect(opener).toBeFocused()
    })

    test('a held Esc in Find clears it once and goes no further', async ({ page }) => {
      await openExample(page)
      await find(page).click()
      await page.keyboard.type('pay')
      // A second keydown without a keyup is an auto-repeat.
      await page.keyboard.down('Escape')
      await page.keyboard.down('Escape')
      await page.keyboard.down('Escape')
      await page.keyboard.up('Escape')
      await expect(find(page)).toHaveValue('')
      expect(await focused(page)).toBe('find')
    })
  })
}

test('at 1280×800, Esc in an empty Find brings a scrollport barely on screen into view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openExample(page)
  // Find at the foot of the window, the scrollport just below it.
  await find(page).evaluate((el) => {
    const top = el.closest('.seq-toolbar')!.getBoundingClientRect().bottom + scrollY
    scrollTo(0, Math.max(0, top - innerHeight + 8))
  })
  await find(page).evaluate((el: HTMLElement) => el.focus({ preventScroll: true }))
  const shown = () =>
    seq(page)
      .locator('.seq-scroll')
      .evaluate((el) => {
        const r = el.getBoundingClientRect()
        return Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)
      })
  expect(await shown()).toBeLessThan(100)
  await page.keyboard.press('Escape')
  expect(await focused(page)).toBe('scrollport')
  await expect.poll(shown).toBeGreaterThanOrEqual(100)
  // Find is still on screen above it.
  await expect(find(page)).toBeInViewport()
})
