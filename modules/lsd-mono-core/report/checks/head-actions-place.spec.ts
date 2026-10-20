import { expect, test, type Page } from '@playwright/test'
import { openExample } from './example-report'

// The Hide and More bar sits just under its header, never on the name it acts on (#92).

interface Placed {
  overlaps: number
  hit: boolean
  opacity: string
  button: number
  gap: number
}

/** Where [id]'s revealed bar sits against that participant's name, and whether it is on top. */
const placeOf = (page: Page, id: string) =>
  page.evaluate((head): Placed => {
    const diagram = document.querySelector('.seq-diagram')!
    const bar = diagram.querySelector(`[data-participant-head="${head}"] .participant-head-actions`)!
    const b = bar.getBoundingClientRect()
    const names = [...diagram.querySelectorAll(`.seq-header-svg [data-participant="${head}"] .participant-label`)]
    const overlaps = names.filter((el) => {
      const n = el.getBoundingClientRect()
      return n.left < b.right && b.left < n.right && n.top < b.bottom && b.top < n.bottom
    }).length
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    const header = diagram.querySelector(`[data-participant-head="${head}"]`)!.getBoundingClientRect()
    return {
      overlaps,
      hit: !!hit?.closest('.participant-head-actions'),
      opacity: getComputedStyle(bar).opacity,
      button: bar.querySelector('button')!.getBoundingClientRect().width,
      gap: b.top - header.bottom,
    }
  }, id)

const heads = (page: Page) =>
  page
    .locator('.seq-diagram [data-participant-head]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-participant-head')!))

test('at 1440 the bar opens under each header, off its name, and stays open on the way down to it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page)
  await page.locator('.seq-diagram').scrollIntoViewIfNeeded()
  const ids = await heads(page)
  expect(ids.length).toBeGreaterThan(3)
  for (const id of ids) {
    const head = page.locator(`.seq-diagram [data-participant-head="${id}"]`)
    await head.scrollIntoViewIfNeeded()
    await head.hover()
    const placed = await placeOf(page, id)
    expect(placed, id).toMatchObject({ overlaps: 0, hit: true, opacity: '1' })
    expect(placed.gap, id).toBeGreaterThanOrEqual(0)
    expect(placed.button, id).toBeGreaterThanOrEqual(24)
  }
  // From the name straight down onto the bar: it stays open.
  const id = ids[1]
  await page.locator(`.seq-diagram [data-participant-head="${id}"]`).scrollIntoViewIfNeeded()
  const head = (await page.locator(`.seq-diagram [data-participant-head="${id}"]`).boundingBox())!
  const bar = page.locator(`.seq-diagram [data-participant-head="${id}"] .participant-head-actions`)
  await page.mouse.move(head.x + 20, head.y + head.height / 2)
  const box = (await bar.boundingBox())!
  await page.mouse.move(box.x + 12, box.y + box.height / 2, { steps: 8 })
  expect((await placeOf(page, id)).opacity).toBe('1')
})

test('at 390 a tap opens the bar under the header, off the name, with 44 px targets', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  })
  try {
    const page = await context.newPage()
    await openExample(page)
    await page.locator('.seq-diagram').scrollIntoViewIfNeeded()
    const ids = await heads(page)
    for (const id of ids.slice(0, 3)) {
      const head = page.locator(`.seq-diagram [data-participant-head="${id}"]`)
      await head.scrollIntoViewIfNeeded()
      await head.tap()
      const placed = await placeOf(page, id)
      expect(placed, id).toMatchObject({ overlaps: 0, hit: true, opacity: '1' })
      expect(placed.button, id).toBeGreaterThanOrEqual(44)
    }
  } finally {
    await context.close()
  }
})

test('at 320, from the keyboard, the whole bar is in view while Hide on the last lane has focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await openExample(page)
  const scroller = page.locator('.seq-diagram .seq-scroll')
  await scroller.scrollIntoViewIfNeeded()
  const ids = await heads(page)
  const last = ids[ids.length - 1]
  const inView = (lane: string) =>
    page.evaluate((id) => {
      const port = document.querySelector('.seq-diagram .seq-scroll')!.getBoundingClientRect()
      const bar = document.querySelector(`.seq-diagram [data-participant-head="${id}"] .participant-head-actions`)
      if (!bar) return { on: false, left: 0, right: 0, focus: '' }
      const b = bar.getBoundingClientRect()
      return {
        on: true,
        left: b.left - port.left,
        right: port.right - b.right,
        focus: document.activeElement?.getAttribute('aria-label') ?? '',
      }
    }, lane)
  // Into the row, End to More on the last lane, then ← to its Hide.
  await page.locator('.seq-diagram .participant-heads button[tabindex="0"]').focus()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  let placed = await inView(last)
  expect(placed.focus).toMatch(/^Hide /)
  expect(placed.right, 'More inside the right edge').toBeGreaterThanOrEqual(0)
  expect(placed.left).toBeGreaterThanOrEqual(0)
  // Tab into the row from outside lands on that same Hide: still the whole bar.
  await scroller.evaluate((el) => (el.scrollLeft = 0))
  await page
    .locator('.seq-diagram .participant-heads button[tabindex="0"]')
    .evaluate((el) => (el as HTMLElement).blur())
  await page.locator('.seq-diagram .participant-heads button[tabindex="0"]').focus()
  placed = await inView(last)
  expect(placed.focus).toMatch(/^Hide /)
  expect(placed.right, 'More inside the right edge after focus from outside').toBeGreaterThanOrEqual(0)
})
