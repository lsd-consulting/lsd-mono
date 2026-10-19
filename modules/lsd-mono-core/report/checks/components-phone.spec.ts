import { readFileSync } from 'node:fs'
import { devices, expect, test, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { seriousViolations } from './ux-helpers'

// #66: on a phone the component diagram used to shrink to the panel, so the example report's
// 11px names drew at 7-8px. Below the stacked-panel width it keeps its natural size and scrolls
// sideways in its own box, opens with its top row centred, and marks each edge with more past it.

/** The live example report's first scenario (14 components), as kitchenSinkSample writes it. */
const example = JSON.parse(readFileSync(new URL('./example-components.json', import.meta.url), 'utf8')) as Report

async function openComponents(page: Page, report: Report | null = example): Promise<void> {
  if (report)
    await page.addInitScript((r) => {
      window.__LSD_REPORT__ = r
    }, report)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
  await page.locator('[data-show-components]').first().click()
  await expect(page.locator('#inspector-graph .component-diagram')).toBeVisible()
}

function drawing(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('#inspector-graph .component-diagram')!
    const scroller = svg.closest<HTMLElement>('.component-scroll')!
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

    test('the example report component diagram keeps readable names, opens on its top row and scrolls sideways', async ({
      page,
    }) => {
      await openComponents(page)
      const first = await drawing(page)
      expect(first.smallest, 'component name size in CSS px').toBeGreaterThanOrEqual(11)
      expect(first.drawnWidth, 'the example draws wider than its box').toBeGreaterThan(first.boxWidth * 2)
      expect(first.topRowInView, 'the top row (the root) is on screen when it opens').toBe(true)
      expect(first.moreRight, 'the right edge is marked while more lies there').toBe(true)
      expect(first.moreLeft, 'and the left edge, once scrolled').toBe(true)
      expect(first.pageOverflowX, 'nothing widens the page').toBeLessThanOrEqual(0)
      await expect(page.locator('.component-links')).toContainText('Tap a link')
      await page.locator('#inspector-graph').scrollIntoViewIfNeeded()
      if (process.env.LSD_SHOTS)
        await page.screenshot({ path: `${process.env.LSD_SHOTS}/q-66-${name.replace(/ /g, '-')}-example.png` })

      await page.locator('.component-scroll').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
      await expect.poll(async () => (await drawing(page)).moreRight).toBe(false)
      await page.locator('.component-scroll').evaluate((el) => el.scrollTo({ left: 0 }))
      await expect.poll(async () => (await drawing(page)).moreLeft).toBe(false)
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
    const edges = () =>
      page.locator('.component-scroll').evaluate((el) => {
        const style = getComputedStyle(el)
        return { right: style.borderRightStyle, left: style.borderLeftStyle, width: style.borderRightWidth }
      })
    expect(await edges()).toEqual({ right: 'dashed', left: 'dashed', width: '3px' })
    await page.locator('#inspector-graph').scrollIntoViewIfNeeded()
    if (process.env.LSD_SHOTS)
      await page.screenshot({ path: `${process.env.LSD_SHOTS}/q-66-iPhone-13-forced-colours.png` })
    await page.locator('.component-scroll').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await expect.poll(async () => (await edges()).right).toBe('solid')
  })
})

test('a link that takes focus is scrolled into view, and the drawing is a focusable region', async ({ browser }) => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })
  const page = await context.newPage()
  await openComponents(page)
  const scroller = page.locator('.component-scroll')
  await expect(scroller).toHaveAttribute('role', 'region')
  await expect(scroller).toHaveAttribute('tabindex', '0')
  const last = page.locator('.component-scroll .edge-group').last()
  await last.focus()
  const inView = await page.evaluate(() => {
    const box = document.querySelector('.component-scroll')!.getBoundingClientRect()
    const link = document.activeElement!.getBoundingClientRect()
    return link.right > box.left && link.left < box.right
  })
  expect(inView).toBe(true)
  await context.close()
})

test('on a desktop panel the example component diagram still fits without scrolling or a marked edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openComponents(page)
  const shown = await drawing(page)
  expect(shown.overflowX).toBeLessThanOrEqual(0)
  expect(shown.moreRight).toBe(false)
  expect(shown.moreLeft).toBe(false)
  // Nothing to scroll, so no empty tab stop before the links.
  await expect(page.locator('.component-scroll')).not.toHaveAttribute('tabindex')
  await expect(page.locator('.component-scroll')).not.toHaveAttribute('role')
  await expect(page.locator('.component-links')).toContainText('Hover over a link')
  if (process.env.LSD_SHOTS) await page.screenshot({ path: `${process.env.LSD_SHOTS}/q-66-1280-example.png` })
})

test('on a desktop panel the dev sample still fits with 11px names', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openComponents(page, null)
  const shown = await drawing(page)
  expect(shown.overflowX).toBeLessThanOrEqual(0)
  expect(shown.smallest).toBeGreaterThanOrEqual(11)
})
