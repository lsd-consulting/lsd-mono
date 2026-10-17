import { devices, expect, test, type Page } from '@playwright/test'
import type { MessageEvent, Report } from '../src/types'
import { uxFixture } from './ux-fixture'
import { THEMES, openFixture, openReport, seriousViolations, formatViolations } from './ux-helpers'

// Side panel: axe with each view open, focus return, component links, metrics and fit-to-content sizing.

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

test('component links have no captions, count their messages, and list them on hover and click', async ({ page }) => {
  await openFixture(page, 'light')
  await page.getByRole('button', { name: 'Component diagram' }).click()
  const graph = page.locator('#inspector-graph')
  await expect(graph.locator('svg.component-diagram')).toBeVisible()
  await expect(graph.locator('.edge-label')).toHaveCount(0)
  await expect(graph.locator('svg text', { hasText: 'charge' })).toHaveCount(0)
  // Client to Api and Api to Database each carry five calls; responses add no link.
  await expect(graph.locator('.edge-badge text')).toHaveText(['5', '5'])
  const link = graph.getByRole('button', { name: 'Api to Database, 5 interactions' })
  await expect(link.locator('> title')).toHaveText(
    [
      'Api to Database, 5 interactions:',
      'insert 1 · sync',
      'insert 4 · sync',
      'insert 7 · sync',
      'insert 10 · sync',
      'insert 13 · sync',
    ].join('\n'),
  )
  await link.locator('.edge-hit').click({ force: true })
  const list = graph.locator('.component-links')
  await expect(list.locator('h3')).toHaveText('Api → Database (5 interactions)')
  await expect(list.locator('li')).toHaveCount(5)
  await expect(list.locator('li').first()).toHaveText('insert 1 · sync')
  const other = graph.getByRole('button', { name: 'Client to Api, 5 interactions' })
  await other.focus()
  await page.keyboard.press('Enter')
  await expect(list.locator('h3')).toHaveText('Client → Api (5 interactions)')
  await expect(other).toHaveClass(/is-selected/)
  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
})

test('axe with metrics in the side panel, and Escape or Close returns focus to the Metrics button', async ({
  page,
}) => {
  for (const theme of THEMES) {
    await openFixture(page, theme)
    // Metrics live in the side panel only, not in the scenario cards.
    await expect(page.locator('.scenario-body .cards h3', { hasText: 'Metrics' })).toHaveCount(0)
    const open = page.getByRole('button', { name: 'Metrics', exact: true })
    await open.click()
    await expect(page.locator('#inspector-title')).toHaveText(/metrics/i)
    await expect(page.locator('#inspector-metrics dl.kv dt')).toHaveText(['Messages'])
    // No ranked duration insights: slow calls are in the Timing view.
    await expect(page.locator('#inspector-metrics ol.insights')).toHaveCount(0)
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
  await expect(page.locator('#inspector-title')).toHaveText(/metrics/i)
  // On screen the print copy is there but not shown.
  await expect(printed).toBeHidden()

  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
  await expect(printed).toBeVisible()
  await expect(printed.locator('dl.kv dt')).toHaveText(['Messages'])
  await expect(printed.locator('button')).toBeHidden()
  await expect(page.locator('#inspector')).toBeHidden()
  // Full card width, not the panel's column, and nothing scrolled out of view.
  const fit = await printed.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const body = el.closest('.scenario-body')!.getBoundingClientRect()
    return {
      left: box.left,
      right: box.right,
      bodyLeft: body.left,
      bodyRight: body.right,
      clipped: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
    }
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

  // Other side-panel views print their own copy, with no metrics. The panel never prints.
  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Component diagram' }).click()
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
  await expect(page.locator('.print-metrics')).toHaveCount(0)
  await expect(page.locator('#inspector')).toBeHidden()

  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
  await metricsBtn.click()
  await page.locator('button.msg-open').first().click()
  await expect(page.locator('#inspector-title')).not.toHaveText('Metrics')
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
  await expect(page.locator('.print-metrics')).toHaveCount(0)
  await expect(page.locator('#inspector')).toBeHidden()
})

test('the component diagram and metrics panels open sized to their content, and a phone keeps the full-width inline panel', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page, 'dark')
  const panel = page.locator('#inspector')
  const fits = (host: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)!
      const box = document.querySelector('#inspector')!.getBoundingClientRect()
      return { width: box.width, overflow: el.scrollWidth - el.clientWidth }
    }, host)

  await page.locator('[data-show-components]').first().click()
  await expect(panel).toBeVisible()
  await expect.poll(async () => (await fits('#inspector-graph')).overflow).toBeLessThanOrEqual(1)
  const graph = await fits('#inspector-graph')
  expect(graph.width).toBeGreaterThanOrEqual(380)
  expect(graph.width).toBeLessThanOrEqual(1440 * 0.5 + 1)
  await page.screenshot({ path: 'test-results/panel-fit-components-desktop.png' })

  await page.locator('[data-show-metrics]').first().click()
  await expect(page.locator('#inspector-metrics')).toBeVisible()
  await expect.poll(async () => (await fits('#inspector-metrics')).overflow).toBeLessThanOrEqual(1)
  const metrics = await fits('#inspector-metrics')
  expect(metrics.width).toBeGreaterThanOrEqual(380)
  expect(metrics.width).toBeLessThanOrEqual(1440 * 0.5 + 1)
  await page.screenshot({ path: 'test-results/panel-fit-metrics-desktop.png' })

  // A drag still resizes after the auto-size.
  const handle = page.locator('#inspector-resize')
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await fits('#inspector-metrics')).width).toBeGreaterThan(metrics.width + 10)

  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  })
  const phone = await context.newPage()
  await openFixture(phone, 'dark')
  for (const [button, host] of [
    ['[data-show-components]', '#inspector-graph'],
    ['[data-show-metrics]', '#inspector-metrics'],
  ] as const) {
    await phone.locator(button).first().click()
    await expect(phone.locator(host)).toBeVisible()
    const box = await phone.locator('#inspector').boundingBox()
    expect(box!.width, `${host} stays the page width on a phone`).toBeGreaterThanOrEqual(388)
    expect(await phone.locator('#inspector').evaluate((el) => getComputedStyle(el).position)).toBe('static')
    await phone.locator(host).scrollIntoViewIfNeeded()
    await phone.screenshot({ path: `test-results/panel-fit-${host.slice(11)}-phone.png` })
  }
  await context.close()
})

/**
 * The fixture with timing: "charge 3" runs inside "place order" (parentId) and took longer than
 * it, and two participant pairs have different accuracy, so the Timing view shows the
 * "Calls inside took longer" warning and the "Accuracy by pair" list.
 */
const timedFixture: Report = {
  ...uxFixture,
  scenarios: uxFixture.scenarios.map((scenario) => ({
    ...scenario,
    accuracy: 'TIMESTAMPED',
    pairAccuracy: [
      { from: 'client', to: 'api', accuracy: 'MEASURED' },
      { from: 'api', to: 'db', accuracy: 'TIMESTAMPED' },
    ],
    events: scenario.events.map((event) => {
      if (event.kind !== 'message') return event
      if (event.id === 'm0') return { ...event, durationMs: 10 }
      if (event.id === 'm3') return { ...event, durationMs: 30, parentId: 'm0' } satisfies MessageEvent
      return event
    }),
  })),
}

async function openTiming(page: Page): Promise<void> {
  await page.locator('.timing-chip').first().click()
  await expect(page.locator('#inspector .timing')).toBeVisible()
}

test('the Timing view shows Accuracy by pair and the longer-than-parent warning, and passes axe', async ({ page }) => {
  await openReport(page, timedFixture)
  await openTiming(page)
  await expect(page.locator('#inspector h4', { hasText: 'Accuracy by pair' })).toBeVisible()
  await expect(page.locator('#inspector .pair-accuracy li')).toHaveText([
    /Client → Api\s+measured/,
    /Api → Database\s+timestamped/,
  ])
  const warning = page.locator('#inspector .waterfall .warnx')
  await expect(warning).toHaveCount(1)
  await expect(warning).toHaveText('Calls inside took longer: 30 ms > 10 ms')
  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
})

test.describe('on a phone', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

  test('the Timing view shows Accuracy by pair and the warning inline, and passes axe', async ({ page }) => {
    await openReport(page, timedFixture)
    await openTiming(page)
    await page.locator('#inspector .pair-accuracy').scrollIntoViewIfNeeded()
    await expect(page.locator('#inspector .pair-accuracy li')).toHaveCount(2)
    await page.locator('#inspector .waterfall .warnx').scrollIntoViewIfNeeded()
    await expect(page.locator('#inspector .waterfall .warnx')).toBeVisible()
    const violations = await seriousViolations(page)
    expect(violations, formatViolations(violations)).toEqual([])
  })
})
