import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { Result } from 'axe-core'
import { uxFixture } from './ux-fixture'

/**
 * Tags axe-core 4.13 actually ships for WCAG A/AA.
 * wcag22aa covers only the 2.2 rules this axe build implements. There is no
 * wcag22a tag. A green run is not a WCAG 2.2 conformance claim.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

const THEMES = ['dark', 'light', 'contrast'] as const

async function openFixture(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript(
    ({ report, themeName }) => {
      const w = window as Window & { __LSD_REPORT__?: unknown }
      w.__LSD_REPORT__ = report
      localStorage.setItem('lsd-report-theme', themeName)
    },
    { report: uxFixture, themeName: theme },
  )
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
  // Context reducedMotion is set in the config, but this Chromium build does not
  // apply it unless emulateMedia runs on the page. The entrance animation otherwise
  // sits near opacity 0 and axe reports false contrast.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
  await expect(page.locator('.msg-label').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

async function seriousViolations(page: Page): Promise<Result[]> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze()
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 8)
        .map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').split('\n')[0]}`)
        .join('\n  ')
      return `${v.id} (${v.impact}) ${v.help}\n  ${nodes}`
    })
    .join('\n')
}

test('axe after the diagram scrolls and after the inspector opens', async ({ page }) => {
  await openFixture(page, 'dark')
  const scroller = page.locator('.seq-scroll')
  await scroller.evaluate((el) => {
    el.scrollTop = 260
  })
  await expect(page.locator('button.msg-open[data-message-id="m6"]')).toBeVisible()
  const afterScroll = await seriousViolations(page)
  expect(afterScroll, formatViolations(afterScroll)).toEqual([])

  await page.locator('button.msg-open[data-message-id="m6"]').click()
  await expect(page.locator('#inspector')).toBeVisible()
  await expect(page.locator('#inspector-title')).toHaveText('charge 6')

  const afterInspector = await seriousViolations(page)
  expect(afterInspector, formatViolations(afterInspector)).toEqual([])

  for (const theme of ['light', 'contrast'] as const) {
    await openFixture(page, theme)
    await page.locator('.seq-scroll').evaluate((el) => {
      el.scrollTop = 260
    })
    await expect(page.locator('button.msg-open[data-message-id="m6"]')).toBeVisible()
    const themed = await seriousViolations(page)
    expect(themed, `${theme}\n${formatViolations(themed)}`).toEqual([])
  }
})

test('axe with the component diagram open, and Escape returns focus to its button', async ({ page }) => {
  for (const theme of THEMES) {
    await openFixture(page, theme)
    const open = page.getByRole('button', { name: 'Component diagram' })
    await open.click()
    await expect(page.locator('#inspector-title')).toHaveText('Component diagram')
    await expect(page.locator('#inspector-graph svg.component-diagram')).toBeVisible()
    // Client, Api, and Database. Queue is in the header but on no message.
    await expect(page.locator('#inspector-graph .component-node')).toHaveCount(3)
    const violations = await seriousViolations(page)
    expect(violations, `${theme}\n${formatViolations(violations)}`).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.locator('#inspector')).toBeHidden()
    await expect(open).toBeFocused()
  }
})

test('axe with metrics in the side panel, and Escape or Close returns focus to the Metrics button', async ({ page }) => {
  for (const theme of THEMES) {
    await openFixture(page, theme)
    // Metrics live in the side panel only, not in the scenario cards.
    await expect(page.locator('.scenario-body .cards h3', { hasText: 'Metrics' })).toHaveCount(0)
    const open = page.getByRole('button', { name: 'Metrics', exact: true })
    await open.click()
    await expect(page.locator('#inspector-title')).toHaveText('Metrics')
    await expect(page.locator('#inspector-metrics dl.kv dt')).toHaveText(['Messages'])
    await expect(page.locator('#inspector-metrics ol.insights li')).toHaveCount(1)
    await expect(page.locator('#inspector-copy')).toBeHidden()
    await expect(page.locator('.json-row')).toBeHidden()
    const violations = await seriousViolations(page)
    expect(violations, `${theme}\n${formatViolations(violations)}`).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.locator('#inspector')).toBeHidden()
    await expect(open).toBeFocused()
  }
  const open = page.getByRole('button', { name: 'Metrics', exact: true })
  await open.click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('#inspector')).toBeHidden()
  await expect(open).toBeFocused()
})

test('print shows metrics only while the Metrics view is open, in its scenario', async ({ page }) => {
  await openFixture(page, 'light')
  const printed = page.locator('#card-ux .print-metrics')
  const metricsBtn = page.getByRole('button', { name: 'Metrics', exact: true })

  await metricsBtn.click()
  await expect(page.locator('#inspector-title')).toHaveText('Metrics')
  // On screen the print copy is there but not shown.
  await expect(printed).toBeHidden()

  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
  await expect(printed).toBeVisible()
  await expect(printed.locator('dl.kv dt')).toHaveText(['Messages'])
  await expect(printed.locator('ol.insights li')).toHaveCount(1)
  await expect(printed.locator('button')).toBeHidden()
  await expect(page.locator('#inspector')).toBeHidden()
  // Full card width, not the panel's column, and nothing scrolled out of view.
  const fit = await printed.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const body = el.closest('.scenario-body')!.getBoundingClientRect()
    return { left: box.left, right: box.right, bodyLeft: body.left, bodyRight: body.right, clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 }
  })
  expect(fit.left).toBeGreaterThanOrEqual(fit.bodyLeft)
  expect(fit.right).toBeLessThanOrEqual(fit.bodyRight)
  expect(fit.right - fit.left).toBeGreaterThan((fit.bodyRight - fit.bodyLeft) * 0.8)
  expect(fit.clipped).toBe(false)

  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
  await page.keyboard.press('Escape')
  await expect(page.locator('#inspector')).toBeHidden()
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
  await expect(page.locator('.print-metrics')).toHaveCount(0)

  // Other side-panel views print as they did before, with no metrics.
  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Component diagram' }).click()
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
  await expect(page.locator('.print-metrics')).toHaveCount(0)
  await expect(page.locator('#inspector')).toBeVisible()

  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
  await metricsBtn.click()
  await page.locator('button.msg-open').first().click()
  await expect(page.locator('#inspector-title')).not.toHaveText('Metrics')
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
  await expect(page.locator('.print-metrics')).toHaveCount(0)
  await expect(page.locator('#inspector')).toBeVisible()
})

/** A narrow, short scenario: Fit zooms it in until it is taller than the stage. */
const shortReport = {
  ...uxFixture,
  scenarios: [
    {
      ...uxFixture.scenarios[0],
      id: 'short',
      title: 'Short',
      insights: undefined,
      participants: uxFixture.scenarios[0].participants.slice(0, 3),
      events: uxFixture.scenarios[0].events.slice(0, 4),
    },
  ],
}

// Headless Chromium hides scrollbars by default, which hides this bug, so this
// test launches its own browser with them shown.
test('Fit leaves no horizontal overflow when zooming in adds the vertical scrollbar', async ({ playwright, baseURL }) => {
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  try {
    const page = await browser.newPage({ viewport: { width: 860, height: 700 }, baseURL })
    await page.addInitScript((report) => {
      ;(window as Window & { __LSD_REPORT__?: unknown }).__LSD_REPORT__ = report
    }, shortReport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    // Styled scrollbars are classic (they take layout space) on every platform,
    // like a desktop browser with a mouse attached.
    await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }' })
    await expect(page.locator('.seq-svg')).toBeVisible()
    const scroll = page.locator('.seq-scroll')
    const before = await scroll.evaluate((el) => ({ tall: el.scrollHeight > el.clientHeight, bar: el.offsetWidth - el.clientWidth }))
    expect(before.tall, 'the short scenario starts without a vertical scrollbar').toBe(false)
    await page.getByRole('button', { name: 'Fit to screen' }).click()
    const after = await scroll.evaluate((el) => ({
      tall: el.scrollHeight > el.clientHeight,
      bar: el.offsetWidth - el.clientWidth,
      overflowX: el.scrollWidth - el.clientWidth,
    }))
    expect(after.tall, 'Fit zoomed the drawing past the stage height').toBe(true)
    expect(after.bar, 'scrollbars take space in this browser').toBeGreaterThan(0)
    expect(after.overflowX).toBeLessThanOrEqual(0)
  } finally {
    await browser.close()
  }
})

test('main content fills the width the sidebar leaves, and the side panel takes its column when open', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await openFixture(page, 'dark')
  const widths = () =>
    page.evaluate(() => {
      const w = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null
      const main = w('#main')!
      const sidebar = w('.sidebar')!
      const inspector = document.querySelector<HTMLElement>('#inspector')!.hidden ? null : w('#inspector')
      return { viewport: document.documentElement.clientWidth, main: main.width, mainLeft: main.left, mainRight: main.right, sidebar: sidebar.width, inspectorLeft: inspector?.left ?? null, inspector: inspector?.width ?? 0 }
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

/** sRGB bytes for any CSS colour the page resolves (oklch, color-mix, hex), via a 1px canvas. */
async function noteColours(page: Page): Promise<{ card: number[]; text: number[] }> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (colour: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = colour
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data]
    }
    const card = getComputedStyle(document.querySelector('.note-card')!)
    const text = getComputedStyle(document.querySelector('.note-text')!)
    return { card: rgba(card.fill), text: rgba(text.fill) }
  })
}

function contrastRatio(a: number[], b: number[]): number {
  const lum = ([r, g, bl]: number[]) => {
    const c = [r, g, bl].map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// axe does not score SVG text, so check note cards directly.
test('note cards are opaque and their text keeps AA contrast in every theme', async ({ page }) => {
  for (const theme of THEMES) {
    await openFixture(page, theme)
    await expect(page.locator('.note-card')).toBeVisible()
    const { card, text } = await noteColours(page)
    expect(card[3], `${theme} note card alpha`).toBe(255)
    expect(contrastRatio(card, text), `${theme} note text contrast`).toBeGreaterThanOrEqual(4.5)
  }
})

test('themes and fit keep the top message label on screen', async ({ page }) => {
  for (const theme of THEMES) {
    await openFixture(page, theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page.locator('.seq-diagram')).toHaveScreenshot(`theme-${theme}.png`)
  }

  await openFixture(page, 'dark')
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  await zoomIn.click()
  await zoomIn.click()
  await page.locator('.seq-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.getByRole('button', { name: 'Fit to screen' }).click()

  const placed = await page.evaluate(() => {
    const label = document.querySelector('.msg-label')
    const scroll = document.querySelector('.seq-scroll')
    const header = document.querySelector('.seq-sticky-header')
    if (!label || !scroll || !header) return null
    const labelBox = label.getBoundingClientRect()
    const scrollBox = scroll.getBoundingClientRect()
    const headerBox = header.getBoundingClientRect()
    const text = (label.textContent ?? '').replace(/\s+/g, ' ').trim()
    return {
      text,
      top: labelBox.top,
      bottom: labelBox.bottom,
      visibleTop: headerBox.bottom,
      visibleBottom: scrollBox.bottom,
    }
  })
  expect(placed).not.toBeNull()
  expect(placed!.text.startsWith('place order')).toBe(true)
  expect(placed!.top).toBeGreaterThanOrEqual(placed!.visibleTop - 1)
  expect(placed!.bottom).toBeLessThanOrEqual(placed!.visibleBottom + 1)
  // The whole width fits, including the frame padding: nothing to scroll sideways.
  const overflowX = await page.locator('.seq-scroll').evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflowX).toBeLessThanOrEqual(0)
  await expect(page.locator('.seq-diagram')).toHaveScreenshot('fit-top-label.png')
})
