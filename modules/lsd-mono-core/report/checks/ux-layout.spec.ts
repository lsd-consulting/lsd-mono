import { expect, test } from '@playwright/test'
import type { Report } from '../src/types'
import { uxFixture } from './ux-fixture'
import { THEMES, openFixture, seriousViolations, formatViolations } from './ux-helpers'

// Layout: Fit, column widths, the collapsed rail and the phone top bar.

/** A narrow, short scenario: Fit zooms it in until it is taller than the stage. */
const shortReport: Report = {
  ...uxFixture,
  scenarios: [
    {
      ...uxFixture.scenarios[0],
      id: 'short',
      title: 'Short',
      participants: uxFixture.scenarios[0].participants.slice(0, 3),
      events: uxFixture.scenarios[0].events.slice(0, 4),
    },
  ],
}

// Headless Chromium hides scrollbars by default, which hides this bug, so this
// test launches its own browser with them shown.
test('Fit leaves no horizontal overflow and adds no vertical scrollbar; the stage grows instead', async ({
  playwright,
  baseURL,
}) => {
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  try {
    const page = await browser.newPage({ viewport: { width: 860, height: 700 }, baseURL })
    await page.addInitScript((report) => {
      window.__LSD_REPORT__ = report
    }, shortReport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    // Styled scrollbars are classic (they take layout space) on every platform,
    // like a desktop browser with a mouse attached.
    await page.addStyleTag({
      content: '::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }',
    })
    await expect(page.locator('.seq-svg')).toBeVisible()
    const scroll = page.locator('.seq-scroll')
    const before = await scroll.evaluate((el: HTMLElement) => ({
      tall: el.scrollHeight > el.clientHeight,
      bar: el.offsetWidth - el.clientWidth,
    }))
    expect(before.tall, 'the short scenario starts without a vertical scrollbar').toBe(false)
    await page.getByRole('button', { name: 'Fit to screen' }).click()
    const after = await scroll.evaluate((el: HTMLElement) => ({
      bar: el.offsetWidth - el.clientWidth,
      overflowX: el.scrollWidth - el.clientWidth,
      stage: el.closest('.seq-stage')!.getBoundingClientRect().height,
      content: el.scrollHeight,
    }))
    expect(after.bar, 'no vertical scrollbar inside the diagram').toBe(0)
    expect(after.stage, 'the stage holds the whole drawing').toBeGreaterThanOrEqual(after.content)
    expect(after.overflowX).toBeLessThanOrEqual(0)
  } finally {
    await browser.close()
  }
})

test('main content fills the width the sidebar leaves, and the side panel takes its column when open', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await openFixture(page, 'dark')
  const widths = () =>
    page.evaluate(() => {
      const w = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null
      const main = w('#main')!
      const sidebar = w('.sidebar')!
      const inspector = document.querySelector<HTMLElement>('#inspector')!.hidden ? null : w('#inspector')
      return {
        viewport: document.documentElement.clientWidth,
        main: main.width,
        mainLeft: main.left,
        mainRight: main.right,
        sidebar: sidebar.width,
        inspectorLeft: inspector?.left ?? null,
        inspector: inspector?.width ?? 0,
      }
    })
  const closed = await widths()
  expect(closed.mainLeft).toBeCloseTo(closed.sidebar, 0)
  expect(closed.main).toBeCloseTo(closed.viewport - closed.sidebar, 0)

  await page.getByRole('button', { name: 'Metrics', exact: true }).click()
  const open = await widths()
  expect(open.inspector).toBeGreaterThan(0)
  expect(open.mainRight).toBeLessThanOrEqual(open.inspectorLeft! + 1)
  expect(open.main).toBeCloseTo(open.viewport - open.sidebar - open.inspector, 0)

  await page.keyboard.press('Escape')
  expect((await widths()).main).toBeCloseTo(closed.main, 0)
})

test('the scenario list collapses to an icon rail, stays collapsed after reload, and passes axe', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openFixture(page, 'dark')
  const sizes = () =>
    page.evaluate(() => ({
      sidebar: document.querySelector('.sidebar')!.getBoundingClientRect().width,
      main: document.querySelector('#main')!.getBoundingClientRect().width,
    }))
  const expanded = await sizes()
  const toggle = page.locator('#btn-sidebar')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  // Keyboard: the toggle is a real button.
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toHaveAccessibleName('Expand scenario list')
  await expect(toggle).toBeFocused()
  const collapsed = await sizes()
  expect(collapsed.sidebar).toBeLessThan(80)
  expect(collapsed.main).toBeCloseTo(expanded.main + expanded.sidebar - collapsed.sidebar, 0)

  // Rail items keep their names and a tooltip; the scenario text is not painted.
  const nav = page.locator('#scenario-nav [data-nav]').first()
  await expect(nav).toHaveAccessibleName(new RegExp(uxFixture.scenarios[0].title))
  await expect(nav).toHaveAttribute('title', new RegExp(uxFixture.scenarios[0].title))
  await expect(nav.locator('.nav-icon')).toBeVisible()
  const textBox = await nav.locator('.nav-title').boundingBox()
  expect(textBox === null || textBox.width <= 1).toBe(true)
  await expect(page.locator('.sidebar-title')).toBeHidden()

  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])

  await page.reload()
  await expect(page.locator('.seq-svg')).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect((await sizes()).sidebar).toBeLessThan(80)

  // Print leaves the scenario list off the page, collapsed or not.
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
  await expect(toggle).toBeHidden()
  await expect(page.locator('.sidebar')).toBeHidden()
  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect((await sizes()).sidebar).toBeCloseTo(expanded.sidebar, 0)
})

test('axe on the collapsed scenario list in every theme', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.addInitScript(() => localStorage.setItem('lsd-report-sidebar', 'collapsed'))
  for (const theme of THEMES) {
    await openFixture(page, theme)
    await expect(page.locator('#btn-sidebar')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#scenario-nav .nav-icon').first()).toBeVisible()
    const violations = await seriousViolations(page)
    expect(violations, `${theme}\n${formatViolations(violations)}`).toEqual([])
  }
})

test('the narrow layout has no sidebar toggle', async ({ page }) => {
  await openFixture(page, 'dark')
  await expect(page.locator('#btn-sidebar')).toBeHidden()
})

test('on a phone the sticky top bar holds its search and status filters while the page scrolls', async ({
  browser,
  baseURL,
}) => {
  // iPhone 13 size, as a touch device. The bar wraps onto two rows there. A fixed grid row
  // used to clamp it to one, and the search box and chips floated over the page on scroll.
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 664 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  })
  try {
    const page = await context.newPage()
    await openFixture(page, 'dark')
    const geometry = () =>
      page.evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
        const bar = box('.topbar')
        const chip = box('.chip.warn')
        const hit = document.elementFromPoint(chip.left + chip.width / 2, chip.top + chip.height / 2)
        return {
          scrollY: window.scrollY,
          barTop: bar.top,
          barBottom: bar.bottom,
          searchBottom: box('.search-wrap').bottom,
          filtersBottom: box('.filters').bottom,
          chipOnTop: !!hit?.closest('.chip.warn'),
          topbarVar: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
        }
      })

    const top = await geometry()
    expect(top.barBottom, 'the bar wraps onto more than one row').toBeGreaterThan(56)
    expect(top.filtersBottom).toBeLessThanOrEqual(top.barBottom + 0.5)
    expect(top.searchBottom).toBeLessThanOrEqual(top.barBottom + 0.5)
    // While stuck only the search row shows: its first row (brand, theme, help) scrolls away.
    const lead = await page.evaluate(
      () => -Number.parseFloat(document.querySelector<HTMLElement>('.topbar')!.style.top),
    )
    expect(lead).toBeGreaterThan(0)
    expect(top.topbarVar).toBe(`${Math.ceil(top.barBottom - top.barTop) - lead}px`)

    await page.evaluate(() => window.scrollBy(0, 600))
    const scrolled = await geometry()
    expect(scrolled.scrollY, 'the page scrolls').toBeGreaterThan(0)
    expect(scrolled.barTop).toBe(-lead)
    expect(Math.abs(scrolled.barBottom - Number.parseFloat(scrolled.topbarVar))).toBeLessThanOrEqual(1)
    expect(scrolled.filtersBottom).toBeLessThanOrEqual(scrolled.barBottom + 0.5)
    expect(scrolled.searchBottom).toBeLessThanOrEqual(scrolled.barBottom + 0.5)
    expect(scrolled.chipOnTop, 'the Warn chip is on top and clickable').toBe(true)

    // A jump to a scenario stops below the taller bar, not under it.
    await page.locator('#scenario-nav button').first().click()
    await expect
      .poll(() =>
        page.evaluate(() => Math.round(document.querySelector('.scenario-card')!.getBoundingClientRect().top)),
      )
      .toBeGreaterThanOrEqual(Math.floor(scrolled.barBottom))
  } finally {
    await context.close()
  }
})
