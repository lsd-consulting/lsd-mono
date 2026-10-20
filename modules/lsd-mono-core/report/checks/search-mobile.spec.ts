import { devices, expect, test, type Page } from '@playwright/test'
import { PAGES, sectionsReport } from './diagram-pages'
import { openReport } from './open-report'

/**
 * Find in the diagram the way a phone types: a tap on the field, then text from the soft
 * keyboard (input events, often with no keydown) and no Enter, with the keyboard taking the
 * bottom of the screen. The first match must come on screen, below the sticky header and above
 * the keyboard, highlighted (no visible "[match]" text), and named on its button for screen readers.
 */
const PHONES = {
  iPhone: devices['iPhone 13'],
  Pixel: devices['Pixel 7'],
} as const

/** Where the current match's label is, against the area between the sticky header and the keyboard. */
async function currentMatch(page: Page): Promise<string> {
  return page.evaluate(() => {
    const hit = document.querySelector<SVGGElement>('.seq-svg .search-current')
    const header = document.querySelector<HTMLElement>('.seq-sticky-header')
    if (!hit || !header) return 'no current match drawn'
    const label = hit.querySelector('.msg-label, .note-card')!.getBoundingClientRect()
    const top = Math.max(header.getBoundingClientRect().bottom, 0)
    const vv = window.visualViewport
    const bottom = vv ? vv.offsetTop + vv.height : innerHeight
    return label.top >= top - 2 && label.bottom <= bottom
      ? 'on screen'
      : `label ${Math.round(label.top)}–${Math.round(label.bottom)}, visible ${Math.round(top)}–${Math.round(bottom)}`
  })
}

for (const [phone, device] of Object.entries(PHONES)) {
  // Chromium with the phone's screen, touch and mobile viewport (the device's own browser is not installed).
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = device
  const context = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }
  for (const [pageName, open] of Object.entries(PAGES)) {
    test.describe(`find on ${phone}, ${pageName} page`, () => {
      test.use(context)

      test('typing with the soft keyboard, no Enter, brings the first match on screen above the keyboard', async ({
        page,
      }) => {
        await open(page, sectionsReport(30))
        await expect(page.locator('.seq-svg')).toBeVisible()
        const find = page.locator('[data-diagram-find]')
        await find.tap()
        // The keyboard takes about half the screen.
        const size = page.viewportSize()!
        await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.55) })
        await page.keyboard.insertText('call 3.2')
        await page.keyboard.insertText('0')
        await expect.poll(() => currentMatch(page), { timeout: 3000 }).toBe('on screen')
        await expect(find).toBeFocused()
        await expect(page.locator('.seq-svg .search-current .msg-label')).toContainText('call 3.20')
        await expect(page.locator('.seq-svg')).not.toContainText('[match]')
        await expect(
          page.locator('.msg-open[aria-label^="Open call 3.20,"][aria-label$=", current search match"]'),
        ).toHaveCount(1)
        const band = await page
          .locator('.seq-svg .search-current .msg-label')
          .evaluate((el) => [getComputedStyle(el).stroke, getComputedStyle(el).strokeWidth])
        expect(band[0]).not.toBe('none')
        expect(Number.parseFloat(band[1])).toBeGreaterThan(4)

        // A new query moves to its own first match.
        await find.fill('')
        await page.keyboard.insertText('call 1.5')
        await expect(page.locator('.seq-svg .search-current .msg-label')).toContainText('call 1.5')
        await expect.poll(() => currentMatch(page), { timeout: 3000 }).toBe('on screen')
      })

      test('the Next and Previous buttons step through matches with N of M, wrapping, on screen', async ({ page }) => {
        await open(page, sectionsReport(30))
        await expect(page.locator('.seq-svg')).toBeVisible()
        const find = page.locator('[data-diagram-find]')
        await find.tap()
        await page.keyboard.insertText('call 2.1')
        const count = page.locator('.diagram-find-count')
        await expect(count).toHaveAttribute('aria-live', 'polite')
        await expect(count).toHaveText('1 of 11')
        const next = page.getByRole('button', { name: 'Next match' })
        const prev = page.getByRole('button', { name: 'Previous match' })
        await next.tap()
        await expect(count).toHaveText('2 of 11')
        const current = page.locator('.seq-svg .search-current .msg-label')
        await expect(current).toContainText('call 2.10')
        await expect(page.locator('.seq-svg .search-current')).toHaveCount(1)
        await expect.poll(() => currentMatch(page), { timeout: 3000 }).toBe('on screen')
        await prev.tap()
        await prev.tap()
        await expect(count).toHaveText('11 of 11')
        await expect(current).toContainText('call 2.19')
        await expect.poll(() => currentMatch(page), { timeout: 3000 }).toBe('on screen')
      })

      test('the keyboard Go / Search key closes the keyboard and shows the match', async ({ page }) => {
        await open(page, sectionsReport(30))
        await expect(page.locator('.seq-svg')).toBeVisible()
        const find = page.locator('[data-diagram-find]')
        await find.tap()
        await page.keyboard.type('call 2.25', { delay: 30 })
        await page.keyboard.press('Enter')
        await expect(find).not.toBeFocused()
        await expect(page.locator('.seq-svg .search-current .msg-label')).toContainText('call 2.25')
      })
    })
  }
}

test('desktop: typing without Enter brings the first match on screen, with a highlight and no [match] text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: sectionsReport(30) })
  await expect(page.locator('.seq-svg')).toBeVisible()
  await page.locator('[data-diagram-find]').click()
  await page.keyboard.type('call 3.20', { delay: 20 })
  await expect.poll(() => currentMatch(page), { timeout: 3000 }).toBe('on screen')
  await expect(page.locator('.seq-svg .search-hit')).toHaveCount(1)
  await expect(page.locator('.seq-svg')).not.toContainText('[match]')
  await expect(page.locator('[data-diagram-find]')).toBeFocused()
})

test('desktop: Enter, Shift+Enter, F3 and Ctrl+G step through matches, wrapping, and focus stays in Find', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: sectionsReport(30) })
  await expect(page.locator('.seq-svg')).toBeVisible()
  const find = page.locator('[data-diagram-find]')
  const count = page.locator('.diagram-find-count')
  const current = page.locator('.seq-svg .search-current .msg-label')
  await expect(page.getByRole('button', { name: 'Next match' })).toBeDisabled()
  await find.click()
  await page.keyboard.type('call 3.2', { delay: 10 })
  await expect(count).toHaveText('1 of 11')
  await expect(page.getByRole('button', { name: 'Next match' })).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(count).toHaveText('2 of 11')
  await expect(current).toContainText('call 3.20')
  await expect.poll(() => currentMatch(page), { timeout: 3000 }).toBe('on screen')
  await page.keyboard.press('F3')
  await expect(count).toHaveText('3 of 11')
  await page.keyboard.press('Control+g')
  await expect(count).toHaveText('4 of 11')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+F3')
  await page.keyboard.press('Shift+Enter')
  await expect(count).toHaveText('1 of 11')
  await page.keyboard.press('Shift+Enter')
  await expect(count).toHaveText('11 of 11')
  await expect(current).toContainText('call 3.29')
  await expect.poll(() => currentMatch(page), { timeout: 3000 }).toBe('on screen')
  await expect(page.locator('.seq-svg .search-current')).toHaveCount(1)
  expect(await page.locator('.seq-svg .search-hit').count()).toBeGreaterThan(1)
  await page.keyboard.press('Enter')
  await expect(count).toHaveText('1 of 11')
  await expect(find).toBeFocused()
  await expect(page.locator('#inspector')).toBeHidden()
})
