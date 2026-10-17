import { expect, test, type Page } from '@playwright/test'
import { openIndex, openReport, sectionsReport } from './diagram-pages'

/**
 * The section jump list above a diagram brings that section to the top of the diagram, in the
 * report page and in the index page, on desktop and phone, whether the drawing is taller than
 * the screen or fits on it. Find (Enter) brings the first match on screen the same way.
 */

/** Where the section's row is, against the top of the area the diagram sticks under. */
async function sectionOffset(page: Page, id: string): Promise<number | null> {
  return page.evaluate((sid) => {
    const row = document.getElementById(`section-${sid}`)
    const port = document.querySelector<HTMLElement>('.seq-scroll')
    const header = document.querySelector<HTMLElement>('.seq-sticky-header')
    if (!row || !port || !header) return null
    const top = Number.parseFloat(getComputedStyle(port).top) || 0
    return row.getBoundingClientRect().top - (top + header.offsetHeight)
  }, id)
}

const PAGES = { report: openReport, index: openIndex } as const
const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } } as const

for (const [pageName, open] of Object.entries(PAGES)) {
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    for (const [drawing, perSection] of [
      ['tall', 30],
      ['short', 3],
    ] as const) {
      test(`section jump: ${pageName} page, ${sizeName}, ${drawing} drawing`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
        await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await open(page, sectionsReport(perSection))
        await expect(page.locator('.seq-svg')).toBeVisible()
        for (const id of ['s2', 's3', 's1']) {
          await page.locator('.section-jump button', { hasText: `Part ${id.slice(1)}` }).click()
          // The last section of a short drawing can only come as far up as the page can scroll.
          const atEnd = await page.evaluate(
            () => Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight,
          )
          await expect
            .poll(() => sectionOffset(page, id), { message: `Part ${id.slice(1)} at the top of the diagram` })
            .toBeGreaterThanOrEqual(-2)
          const offset = (await sectionOffset(page, id)) ?? Infinity
          if (!atEnd) expect(offset).toBeLessThanOrEqual(24)
          else expect(offset).toBeLessThan(viewport.height)
        }
      })
    }
  }
}

for (const [pageName, open] of Object.entries(PAGES)) {
  for (const [sizeName, viewport] of Object.entries(SIZES)) {
    for (const [drawing, perSection] of [
      ['tall', 30],
      ['short', 6],
    ] as const) {
      test(`find: ${pageName} page, ${sizeName}, ${drawing} drawing, Enter brings the current match on screen`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
        await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await open(page, sectionsReport(perSection))
        await expect(page.locator('.seq-svg')).toBeVisible()
        for (const label of [`call 3.${perSection - 2}`, 'call 1.2']) {
          const find = page.locator('[data-diagram-find]')
          await find.fill(label)
          await find.press('Enter')
          await expect
            .poll(
              () =>
                page.evaluate((text) => {
                  // Enter steps to the next match: call 1.2 also matches call 1.20 to 1.29.
                  const hit = document.querySelector<SVGTextElement>('.seq-svg .search-current .msg-label')
                  if (!hit?.textContent?.trim().startsWith(text)) return 'not drawn'
                  const header = document.querySelector<HTMLElement>('.seq-sticky-header')
                  if (!hit || !header) return 'not drawn'
                  const box = hit.getBoundingClientRect()
                  const under = header.getBoundingClientRect().bottom
                  return box.top >= under - 2 && box.bottom <= innerHeight
                    ? 'on screen'
                    : `at ${Math.round(box.top)}, header ends ${Math.round(under)}`
                }, label),
              { message: `${label} on screen` },
            )
            .toBe('on screen')
          await page.keyboard.press('Escape')
        }
      })
    }
  }
}
