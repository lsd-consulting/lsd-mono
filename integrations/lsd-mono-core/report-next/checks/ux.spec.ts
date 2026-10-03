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
      localStorage.setItem('lsd-report-next-theme', themeName)
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
  await expect(page.locator('.seq-diagram')).toHaveScreenshot('fit-top-label.png')
})
