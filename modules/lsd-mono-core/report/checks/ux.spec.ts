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
    ['Api to Database, 5 interactions:', 'insert 1 · sync', 'insert 4 · sync', 'insert 7 · sync', 'insert 10 · sync', 'insert 13 · sync'].join('\n'),
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

/** The fixture with one long payload: a very long line and many lines. */
const longPayloadReport = {
  ...uxFixture,
  scenarios: uxFixture.scenarios.map((scenario) => ({
    ...scenario,
    events: scenario.events.map((event) =>
      event.id === 'm1'
        ? {
            ...event,
            data: {
              ...(event.data as Record<string, unknown>),
              note: 'unbroken-'.repeat(60),
              lines: Array.from({ length: 70 }, (_, i) => `line ${i}`),
            },
          }
        : event,
    ),
  })),
}

async function openReport(page: Page, report: unknown): Promise<void> {
  await page.addInitScript((value) => {
    ;(window as Window & { __LSD_REPORT__?: unknown }).__LSD_REPORT__ = value
    localStorage.setItem('lsd-report-theme', 'light')
  }, report)
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
}

/** What the browser does around window.print(): beforeprint paints every diagram row. */
async function startPrint(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
}

async function endPrint(page: Page): Promise<void> {
  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
}

test('print leaves out the scenario list and toolbars, prints nothing from a closed panel, and draws diagrams at page width', async ({ page }) => {
  await openReport(page, uxFixture)
  await startPrint(page)
  for (const chrome of ['.topbar', '.sidebar', '.seq-toolbar', '.seq-minimap', '#inspector']) {
    await expect(page.locator(chrome), chrome).toBeHidden()
  }
  await expect(page.locator('.print-panel')).toHaveCount(0)
  await expect(page.locator('.print-metrics')).toHaveCount(0)
  // Every message, not just the rows that were in view on screen.
  await expect(page.locator('.seq-window .msg-label')).toHaveCount(14)
  const fit = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    const max = parseFloat(getComputedStyle(document.querySelector('.seq-diagram')!).getPropertyValue('--seq-print-max'))
    const body = document.querySelector('.seq-window .seq-svg')!.getBoundingClientRect()
    const head = document.querySelector('.seq-header-svg')!.getBoundingClientRect()
    return { room: scroll.clientWidth, max, body: body.width, head: head.width }
  })
  expect(fit.body).toBeLessThanOrEqual(fit.room + 1)
  expect(fit.body).toBeGreaterThanOrEqual(Math.min(fit.room, fit.max) - 2)
  expect(fit.head).toBeCloseTo(fit.body, 0)
  await endPrint(page)
})

test('print shows the open message JSON in full, in its scenario after the diagram', async ({ page }) => {
  await openReport(page, longPayloadReport)
  await page.locator('button.msg-open[data-message-id="m1"]').click()
  await expect(page.locator('#inspector-pre')).toBeVisible()
  await expect(page.locator('#inspector-pre')).toContainText('line 69')
  const shown = await page.locator('#inspector-pre').textContent()
  const printed = page.locator('#card-ux .print-message')
  await expect(printed).toBeHidden()

  await startPrint(page)
  await expect(printed).toBeVisible()
  await expect(page.locator('#inspector')).toBeHidden()
  await expect(printed.locator('h3')).toHaveText('Message · insert 1')
  await expect(printed.locator('pre')).toHaveText(shown!)
  const fit = await printed.evaluate((el) => {
    const pre = el.querySelector('pre')!
    const box = el.getBoundingClientRect()
    const body = el.closest('.scenario-body')!.getBoundingClientRect()
    return {
      afterDiagram: el.previousElementSibling?.classList.contains('diagram-panel') ?? false,
      width: box.width,
      body: body.width,
      clippedX: pre.scrollWidth > pre.clientWidth + 1,
      clippedY: pre.scrollHeight > pre.clientHeight + 1,
    }
  })
  expect(fit.afterDiagram).toBe(true)
  expect(fit.width).toBeGreaterThan(fit.body * 0.8)
  expect(fit.clippedX).toBe(false)
  expect(fit.clippedY).toBe(false)
  await endPrint(page)

  // Hidden JSON is not printed; the message heading still is.
  await page.getByRole('button', { name: 'Hide JSON' }).click()
  await startPrint(page)
  await expect(printed).toBeVisible()
  await expect(printed.locator('pre')).toHaveCount(0)
  await endPrint(page)

  await page.keyboard.press('Escape')
  await expect(page.locator('#inspector')).toBeHidden()
  await startPrint(page)
  await expect(page.locator('.print-panel')).toHaveCount(0)
  await endPrint(page)
})

test('print shows the open component diagram whole, at page width, after the sequence diagram', async ({ page }) => {
  await openReport(page, uxFixture)
  await page.getByRole('button', { name: 'Component diagram' }).click()
  await expect(page.locator('#inspector-graph svg.component-diagram')).toBeVisible()
  const printed = page.locator('#card-ux .print-components')
  await expect(printed).toBeHidden()

  await startPrint(page)
  await expect(printed).toBeVisible()
  await expect(page.locator('#inspector')).toBeHidden()
  await expect(printed.locator('.component-node')).toHaveCount(3)
  const fit = await printed.evaluate((el) => {
    const svg = el.querySelector('svg.component-diagram')!
    const box = el.getBoundingClientRect()
    const drawing = svg.getBoundingClientRect()
    const style = getComputedStyle(el)
    const room = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
    const max = parseFloat(style.getPropertyValue('--print-components-max'))
    return {
      afterDiagram: el.previousElementSibling?.classList.contains('diagram-panel') ?? false,
      breakInside: style.breakInside,
      left: drawing.left - box.left,
      right: box.right - drawing.right,
      width: drawing.width,
      room,
      max,
    }
  })
  expect(fit.afterDiagram).toBe(true)
  expect(fit.breakInside).toBe('avoid')
  expect(fit.left).toBeGreaterThanOrEqual(0)
  expect(fit.right).toBeGreaterThanOrEqual(0)
  expect(fit.width).toBeGreaterThanOrEqual(Math.min(fit.room, fit.max) - 2)
  await endPrint(page)

  await page.keyboard.press('Escape')
  await startPrint(page)
  await expect(page.locator('.print-panel')).toHaveCount(0)
  await endPrint(page)
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

test('on a phone the sticky top bar holds its search and status filters while the page scrolls', async ({ browser, baseURL }) => {
  // iPhone 13 size, as a touch device. The bar wraps onto three rows there. A fixed grid row
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
    expect(top.topbarVar).toBe(`${Math.ceil(top.barBottom - top.barTop)}px`)

    await page.evaluate(() => window.scrollBy(0, 600))
    const scrolled = await geometry()
    expect(scrolled.scrollY, 'the page scrolls').toBeGreaterThan(0)
    expect(scrolled.barTop).toBe(0)
    expect(scrolled.filtersBottom).toBeLessThanOrEqual(scrolled.barBottom + 0.5)
    expect(scrolled.searchBottom).toBeLessThanOrEqual(scrolled.barBottom + 0.5)
    expect(scrolled.chipOnTop, 'the Warn chip is on top and clickable').toBe(true)

    // A jump to a scenario stops below the taller bar, not under it.
    await page.locator('#scenario-nav button').first().click()
    await expect
      .poll(() => page.evaluate(() => Math.round(document.querySelector('.scenario-card')!.getBoundingClientRect().top)))
      .toBeGreaterThanOrEqual(Math.floor(scrolled.barBottom))
  } finally {
    await context.close()
  }
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

/** One long display name per participant shape, next to each other. */
const longNamesReport = {
  ...uxFixture,
  scenarios: [
    {
      ...uxFixture.scenarios[0],
      id: 'names',
      title: 'Long names',
      insights: undefined,
      participants: [
        { id: 'client', name: 'Client', alias: 'Signed-in Customer (mobile app)', type: 'ACTOR' },
        { id: 'api', name: 'Api', alias: 'Public API Gateway (rate limited)', type: 'BOUNDARY' },
        { id: 'db', name: 'Database', alias: 'Orders DB (PostgreSQL primary)', type: 'DATABASE' },
        { id: 'bus', name: 'Queue', alias: 'Kafka topic order-events.v2', type: 'QUEUE' },
        { id: 'basket', name: 'Basket', alias: 'Shopping Basket Aggregate', type: 'ENTITY' },
        { id: 'svc', name: 'Svc', alias: 'Customer Notification Preferences and Delivery Orchestration Service', type: 'PARTICIPANT' },
        { id: 'stock', name: 'Inventory Service', type: 'PARTICIPANT' },
      ],
    },
  ],
}

test('long participant names stay inside their shapes and clear of their neighbours', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.addInitScript((report) => {
    ;(window as Window & { __LSD_REPORT__?: unknown }).__LSD_REPORT__ = report
  }, longNamesReport)
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.seq-header-svg')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<SVGGElement>('.seq-header-svg .participant-box')].map((g) => {
      const label = g.querySelector<SVGTextElement>('.participant-label')!.getBBox()
      const shape = g.querySelector<SVGGraphicsElement>('.participant-shape, .participant-actor')!.getBBox()
      const header = (g.ownerSVGElement!.viewBox.baseVal)
      const x = Number(/translate\(([-\d.]+)/.exec(g.getAttribute('transform')!)![1])
      return {
        id: g.dataset.participant!,
        type: g.dataset.participantType!,
        title: g.querySelector('title')!.textContent!,
        lines: g.querySelectorAll('tspan').length || 1,
        label: { left: x + label.x, right: x + label.x + label.width, top: label.y, bottom: label.y + label.height },
        shape: { left: x + shape.x, right: x + shape.x + shape.width, top: shape.y, bottom: shape.y + shape.height },
        header: { left: header.x, right: header.x + header.width, height: header.height },
      }
    }),
  )
  expect(boxes).toHaveLength(7)
  for (const box of boxes) {
    // Inside the header block, top to bottom and side to side.
    expect(box.label.top, box.id).toBeGreaterThanOrEqual(0)
    expect(box.label.bottom, box.id).toBeLessThanOrEqual(box.header.height + 1)
    expect(box.label.left, box.id).toBeGreaterThanOrEqual(box.header.left)
    expect(box.label.right, box.id).toBeLessThanOrEqual(box.header.right)
    if (['PARTICIPANT', 'DATABASE', 'QUEUE'].includes(box.type)) {
      expect(box.label.left, box.id).toBeGreaterThanOrEqual(box.shape.left + 2)
      expect(box.label.right, box.id).toBeLessThanOrEqual(box.shape.right - 2)
    }
  }
  // Neighbours never overlap: neither shapes nor names.
  for (let i = 1; i < boxes.length; i++) {
    const before = Math.max(boxes[i - 1].label.right, boxes[i - 1].shape.right)
    const after = Math.min(boxes[i].label.left, boxes[i].shape.left)
    expect(after - before, `${boxes[i - 1].id} | ${boxes[i].id}`).toBeGreaterThan(4)
  }
  const svc = boxes.find((box) => box.id === 'svc')!
  expect(svc.lines).toBe(2)
  expect(svc.title).toBe('Customer Notification Preferences and Delivery Orchestration Service, component')
  await expect(page.locator('.seq-header-svg')).toHaveAttribute('aria-label', /Customer Notification Preferences and Delivery Orchestration Service/)
  expect(boxes.find((box) => box.id === 'stock')!.lines).toBe(1)
})

/** Two scenarios too wide for the panel at 100%: twelve lifelines, a chain of 30 calls. */
function wideScenario(id: string, title: string) {
  const participants = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `Service ${i}`, type: 'PARTICIPANT' }))
  const events = Array.from({ length: 30 }, (_, i) => ({
    kind: 'message',
    id: `m${i}`,
    from: `p${i % 12}`,
    to: `p${(i + 5) % 12}`,
    label: `call ${i}`,
    type: 'SYNCHRONOUS',
    data: { n: i },
  }))
  return { ...uxFixture.scenarios[0], id, title, insights: undefined, participants, events }
}
const wideReport = { ...uxFixture, scenarios: [wideScenario('wide-a', 'Wide A'), wideScenario('wide-b', 'Wide B')] }

async function openWide(page: Page, hash = ''): Promise<void> {
  await page.addInitScript((report) => {
    ;(window as Window & { __LSD_REPORT__?: unknown }).__LSD_REPORT__ = report
  }, wideReport)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/${hash}`)
  await expect(page.locator('.seq-svg').first()).toBeVisible()
}

/** Zoom readout as a number (85 for "85%") and sideways overflow, for one scenario's diagram. */
function zoomOf(page: Page, scenarioId: string) {
  return page.evaluate((id) => {
    const card = document.getElementById(`card-${id}`)!
    const scroll = card.querySelector<HTMLElement>('.seq-scroll')!
    return {
      percent: Number.parseInt(card.querySelector('.zoom-readout')!.textContent ?? '', 10),
      overflowX: scroll.scrollWidth - scroll.clientWidth,
    }
  }, scenarioId)
}

test('a wide diagram opens fitted, refits on resize until the user zooms, then keeps their zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openWide(page)
  const first = await zoomOf(page, 'wide-a')
  expect(first.percent, 'opens below 100%, fitted to the panel').toBeLessThan(100)
  expect(first.overflowX, 'nothing to scroll sideways').toBeLessThanOrEqual(0)

  // Not zoomed yet: a narrower window refits.
  await page.setViewportSize({ width: 900, height: 800 })
  await expect.poll(async () => (await zoomOf(page, 'wide-a')).percent).toBeLessThan(first.percent)
  expect((await zoomOf(page, 'wide-a')).overflowX).toBeLessThanOrEqual(0)

  // Once the user zooms, resizing leaves their zoom alone.
  const card = page.locator('#card-wide-a')
  await card.getByRole('button', { name: 'Zoom in' }).click()
  const chosen = (await zoomOf(page, 'wide-a')).percent
  await page.setViewportSize({ width: 1300, height: 800 })
  await page.waitForTimeout(250)
  expect((await zoomOf(page, 'wide-a')).percent).toBe(chosen)

  // Fit hands it back to automatic fitting.
  await card.getByRole('button', { name: 'Fit to screen' }).click()
  const fitted = (await zoomOf(page, 'wide-a')).percent
  await page.setViewportSize({ width: 1000, height: 800 })
  await expect.poll(async () => (await zoomOf(page, 'wide-a')).percent).toBeLessThan(fitted)
  expect((await zoomOf(page, 'wide-a')).overflowX).toBeLessThanOrEqual(0)
})

test('a collapsed scenario is fitted when it opens', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openWide(page)
  await page.locator('#card-wide-b .scenario-head').click()
  await expect(page.locator('#card-wide-b .seq-svg')).toBeVisible()
  const opened = await zoomOf(page, 'wide-b')
  expect(opened.percent).toBeLessThan(100)
  expect(opened.overflowX).toBeLessThanOrEqual(0)
})

test('a deep link to a message in a collapsed, fitted diagram scrolls to it and opens it', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openWide(page, '#msg=wide-b/m25')
  await expect(page.locator('#inspector-title')).toHaveText('call 25')
  expect((await zoomOf(page, 'wide-b')).percent).toBeLessThan(100)
  const target = page.locator('#card-wide-b button.msg-open[data-message-id="m25"]')
  await expect(target).toHaveAttribute('tabindex', '0')
  const placed = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('#card-wide-b .seq-scroll')!
    const header = scroll.querySelector<HTMLElement>('.seq-sticky-header')!
    const btn = scroll.querySelector<HTMLElement>('button.msg-open[data-message-id="m25"]')!
    const b = btn.getBoundingClientRect()
    return { top: b.top, bottom: b.bottom, visibleTop: header.getBoundingClientRect().bottom, visibleBottom: scroll.getBoundingClientRect().bottom }
  })
  expect(placed.top).toBeGreaterThanOrEqual(placed.visibleTop - 1)
  expect(placed.bottom).toBeLessThanOrEqual(placed.visibleBottom + 1)
})
