import { expect, test, type Page } from '@playwright/test'
import { openExample } from './example-report'

/** Widths where v0.16.0 squeezed search and spilled the status chips (#229), plus phone 390. */
const WIDTHS = [390, 568, 640, 768, 820, 900] as const

async function assertBarFits(page: Page, width: number, minSearch: number) {
  const barBox = (await page.locator('.topbar').boundingBox())!
  const search = (await page.locator('.search-wrap input').boundingBox())!
  expect(search.width, `${width}px search`).toBeGreaterThanOrEqual(minSearch)

  const chips = page.locator('.filters .chip')
  expect(await chips.count(), `${width}px chips`).toBeGreaterThanOrEqual(4)
  for (const chip of await chips.all()) {
    const box = (await chip.boundingBox())!
    expect(box.width, 'chip width').toBeGreaterThanOrEqual(24)
    expect(box.height, 'chip height').toBeGreaterThanOrEqual(24)
    expect(box.x, 'chip left').toBeGreaterThanOrEqual(barBox.x - 1)
    expect(box.y, 'chip top').toBeGreaterThanOrEqual(barBox.y - 1)
    expect(box.x + box.width, 'chip right').toBeLessThanOrEqual(barBox.x + barBox.width + 1)
    expect(box.y + box.height, 'chip bottom').toBeLessThanOrEqual(barBox.y + barBox.height + 1)
  }

  const toolbar = page.locator('.seq-toolbar').first()
  if (await toolbar.isVisible()) {
    const tool = (await toolbar.boundingBox())!
    expect(barBox.y + barBox.height, `${width}px bar vs toolbar`).toBeLessThanOrEqual(tool.y + 1)
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

  const overflow = await page.locator('.search-wrap input').evaluate((el: HTMLInputElement) => {
    const cs = getComputedStyle(el)
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = cs.font
    const textW = ctx.measureText(el.placeholder).width
    const padL = parseFloat(cs.paddingLeft)
    const padR = parseFloat(cs.paddingRight)
    const kbd = el.parentElement?.querySelector('.kbd')
    const kbdHidden = !kbd || kbd.hasAttribute('hidden') || getComputedStyle(kbd).display === 'none'
    const kbdW = kbdHidden ? 0 : kbd.getBoundingClientRect().width + 8
    return textW > el.clientWidth - padL - padR - kbdW + 0.5
  })
  expect(overflow, `${width}px placeholder clipped`).toBe(false)
}

for (const width of WIDTHS) {
  test(`${width}px: search stays readable and the status chips stay inside the top bar`, async ({ page }) => {
    await openExample(page, undefined, { viewport: { width, height: 800 } })
    await assertBarFits(page, width, 160)
  })
}

test('640x400 (200% zoom on 1280x800): chips stay in the bar after scrolling into the diagram', async ({ page }) => {
  await openExample(page, undefined, { viewport: { width: 640, height: 400 } })
  await assertBarFits(page, 640, 160)
  await page
    .locator('.seq-diagram')
    .first()
    .evaluate((el) => el.scrollIntoView())
  await assertBarFits(page, 640, 160)
})

test('1440px: the labelled chips still share the one-row bar with a readable search', async ({ page }) => {
  await openExample(page, undefined, { viewport: { width: 1440, height: 900 } })
  await assertBarFits(page, 1440, 160)
  const bar = (await page.locator('.topbar').boundingBox())!
  expect(bar.height).toBeLessThanOrEqual(64)
})

test('568px: the theme and help buttons stay on the chip row', async ({ page }) => {
  await openExample(page, undefined, { viewport: { width: 568, height: 800 } })
  await assertBarFits(page, 568, 160)
  const chips = (await page.locator('.filters').boundingBox())!
  const actions = (await page.locator('.top-actions').boundingBox())!
  expect(actions.y, 'actions share the chip row').toBeLessThanOrEqual(chips.y + 8)
  expect(actions.y + actions.height).toBeGreaterThan(chips.y)
  expect(actions.y).toBeLessThan(chips.y + chips.height)
})

test('940px: the shortened search placeholder is not cut off', async ({ page }) => {
  await openExample(page, undefined, { viewport: { width: 940, height: 800 } })
  await assertBarFits(page, 940, 160)
})
