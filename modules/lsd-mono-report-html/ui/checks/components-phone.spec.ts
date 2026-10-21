import { devices, expect, test, type Page } from '@playwright/test'
import { conformanceReport } from '../src/lib/conformance.test-util'
import type { Report } from '../src/types'
import { seriousViolations } from './ux-helpers'
import { openReport } from './open-report'

// #66, kept by the Components view (#105): at 1:1 the component diagram has its natural size, so
// the example report's 11px names stay 11px, and scrolls sideways in its own box, marking each
// edge with more past it. Since #120 it opens on the whole graph, and 1:1 is one press away.

/** The live example report's first scenario (14 components), as kitchenSinkSample writes it. */
const example = conformanceReport('example-components')

/** 1:1 (#120): the natural size. */
async function actualSize(page: Page): Promise<void> {
  await page.locator('.comp-toolbar').getByRole('button', { name: '1:1 actual size, readable' }).click()
  await expect(page.locator('.comp-toolbar [data-zoom="reset"]')).toHaveText('100%')
  await page.evaluate(() => new Promise(requestAnimationFrame))
}

async function openComponents(page: Page, report: Report | null = example): Promise<void> {
  await openReport(page, report ? { report } : {})
  await page.getByRole('tab', { name: 'Components' }).click()
  await expect(page.locator('.comp-scroll .component-diagram')).toBeVisible()
  // The top row is centred the first time the view has a width, before the next frame.
  await page.evaluate(() => new Promise(requestAnimationFrame))
}

function drawing(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('.comp-scroll .component-diagram')!
    const scroller = svg.closest<HTMLElement>('.comp-scroll')!
    const sizes = [...svg.querySelectorAll<SVGTextElement>('.component-node text')].map(
      (text) => Number.parseFloat(getComputedStyle(text).fontSize) * text.getScreenCTM()!.a,
    )
    const box = scroller.getBoundingClientRect()
    const nodes = [...svg.querySelectorAll('.component-node')].map((node) => node.getBoundingClientRect())
    const top = Math.min(...nodes.map((node) => node.top))
    const topRow = nodes.filter((node) => node.top < top + 1)
    return {
      smallest: Math.min(...sizes),
      overflowX: scroller.scrollWidth - scroller.clientWidth,
      moreRight: scroller.hasAttribute('data-more-right'),
      moreLeft: scroller.hasAttribute('data-more-left'),
      drawnWidth: Math.round(svg.getBoundingClientRect().width),
      boxWidth: Math.round(box.width),
      topRowInView: topRow.every((node) => node.left >= box.left - 1 && node.right <= box.right + 1),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

for (const name of ['iPhone 13', 'Pixel 7'] as const) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices[name]
  test.describe(name, () => {
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('the example report component diagram opens whole, and at 1:1 keeps readable names and scrolls sideways', async ({
      page,
    }) => {
      await openComponents(page)
      const opened = await drawing(page)
      expect(opened.overflowX, 'the whole graph across (#120)').toBeLessThanOrEqual(0)
      expect(opened.topRowInView, 'the top row (the root) is on screen when it opens').toBe(true)
      expect(opened.pageOverflowX, 'nothing widens the page').toBeLessThanOrEqual(0)
      await actualSize(page)
      const first = await drawing(page)
      expect(first.smallest, 'component name size in CSS px').toBeGreaterThanOrEqual(11)
      expect(first.drawnWidth, 'the example draws wider than its box').toBeGreaterThan(first.boxWidth * 2)
      expect(first.pageOverflowX, 'nothing widens the page').toBeLessThanOrEqual(0)
      await page.locator('.comp-scroll').scrollIntoViewIfNeeded()
      if (process.env.LSD_SHOTS)
        await page.screenshot({ path: `${process.env.LSD_SHOTS}/q-66-${name.replace(/ /g, '-')}-example.png` })

      await page.locator('.comp-scroll').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
      await expect.poll(async () => (await drawing(page)).moreRight).toBe(false)
      expect((await drawing(page)).moreLeft, 'the left edge is marked while more lies there').toBe(true)
      await page.locator('.comp-scroll').evaluate((el) => el.scrollTo({ left: 0 }))
      await expect.poll(async () => (await drawing(page)).moreLeft).toBe(false)
      expect((await drawing(page)).moreRight, 'and the right edge').toBe(true)
      expect(await seriousViolations(page)).toEqual([])
    })
  })
}

test.describe('forced colours on a phone', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

  test('each edge with more of the drawing past it has a border, as the shadow is dropped', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await openComponents(page)
    await actualSize(page)
    await page.locator('.comp-scroll').evaluate((el) => el.scrollTo({ left: (el.scrollWidth - el.clientWidth) / 2 }))
    const edges = () =>
      page.locator('.comp-scroll').evaluate((el) => {
        const style = getComputedStyle(el)
        return { right: style.borderRightStyle, left: style.borderLeftStyle, width: style.borderRightWidth }
      })
    await expect.poll(edges).toEqual({ right: 'dashed', left: 'dashed', width: '3px' })
    await page.locator('.comp-scroll').scrollIntoViewIfNeeded()
    if (process.env.LSD_SHOTS)
      await page.screenshot({ path: `${process.env.LSD_SHOTS}/q-66-iPhone-13-forced-colours.png` })
    await page.locator('.comp-scroll').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await expect.poll(async () => (await edges()).right).toBe('solid')
  })
})

test('a link that takes focus is scrolled into view, and the drawing is a focusable region', async ({ browser }) => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })
  const page = await context.newPage()
  await openComponents(page)
  // Fitted whole, there is nothing to scroll; at 1:1 there is (#120).
  await expect(page.locator('.comp-scroll')).not.toHaveAttribute('tabindex')
  await actualSize(page)
  const scroller = page.locator('.comp-scroll')
  await expect(scroller).toHaveAttribute('role', 'region')
  await expect(scroller).toHaveAttribute('tabindex', '0')
  const last = page.locator('.comp-scroll .edge-group').last()
  await last.focus()
  const inView = await page.evaluate(() => {
    const box = document.querySelector('.comp-scroll')!.getBoundingClientRect()
    const link = document.activeElement!.getBoundingClientRect()
    return link.right > box.left && link.left < box.right
  })
  expect(inView).toBe(true)
  await context.close()
})

test('at 1440 the example component diagram opens whole, and 1:1 is its natural size, so names are 11px (#91)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openComponents(page)
  const opened = await drawing(page)
  expect(opened.drawnWidth).toBeLessThan(1091)
  expect(opened.topRowInView).toBe(true)
  await actualSize(page)
  const shown = await drawing(page)
  // Drawn at 1091 px, not shrunk to its box as the side panel did (6.9 px names).
  expect(shown.smallest).toBeGreaterThanOrEqual(11)
  expect(shown.drawnWidth).toBe(1091)
  expect(shown.pageOverflowX).toBeLessThanOrEqual(0)
  if (process.env.LSD_SHOTS) await page.screenshot({ path: `${process.env.LSD_SHOTS}/q-105-1440-example.png` })
})

test('at 1280 the dev sample fits with 11px names, without a scroll cue or an empty tab stop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openComponents(page, null)
  const shown = await drawing(page)
  expect(shown.overflowX).toBeLessThanOrEqual(0)
  expect(shown.smallest).toBeGreaterThanOrEqual(11)
  expect(shown.moreRight).toBe(false)
  expect(shown.moreLeft).toBe(false)
  await expect(page.locator('.comp-scroll')).not.toHaveAttribute('tabindex')
  await expect(page.locator('.comp-scroll')).not.toHaveAttribute('role')
})
