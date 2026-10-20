import { devices, expect, test, type Page } from '@playwright/test'
import { findReport, openFindIndex, openFindReport } from './find-fixture'
import { openReport } from './open-report'
import { THEMES, computedColours, contrastRatio, formatViolations, seriousViolations } from './ux-helpers'

// Find in payloads (#60): the arrows whose payload matches count and step like label matches.

const findReportWithoutPayloads = {
  ...findReport,
  scenarios: findReport.scenarios.map((scenario) => ({
    ...scenario,
    events: scenario.events.map((event) =>
      event.kind === 'message' ? { ...event, data: undefined, payloadId: undefined } : event,
    ),
  })),
}

const pages = {
  report: (page: Page) => openFindReport(page),
  index: (page: Page) => openFindIndex(page),
  // A report written before #63, listed on a newer index page.
  'index, older payload script': (page: Page) => openFindIndex(page, { legacy: true }),
}

for (const [pageName, open] of Object.entries(pages)) {
  test(`find (${pageName} page): payload matches count, step and are named like label matches`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await open(page)
    const find = page.locator('[data-diagram-find]')
    const count = page.locator('.diagram-find-count')
    await find.click()
    await page.keyboard.type('snowdrop', { delay: 10 })
    await expect(count).toHaveText('1 of 3, 2 in payloads')
    await expect(
      page.locator('.msg-open[aria-label^="Open place order,"][aria-label*="current search match"]'),
    ).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(count).toHaveText('2 of 3, 2 in payloads')
    await expect(page.locator('.seq-svg .search-current .msg-label')).toContainText('reserve stock')
    await page.keyboard.press('Enter')
    await expect(page.locator('.seq-svg .search-current .msg-label')).toContainText('snowdrop applied')
    await page.keyboard.press('Enter')
    await expect(count).toHaveText('1 of 3, 2 in payloads')
    // A query only a deferred payload holds.
    await find.fill('sock-1')
    await expect(count).toHaveText('1 of 2, 2 in payloads')
    await find.fill('nowhere at all')
    await expect(count).toHaveText('0 matches')
    await expect(page.locator('#inspector')).toBeHidden()
  })
}

const payloadMarker = (state: 'current' | 'match') =>
  `.seq-svg .message[data-search-hit="${state}"][data-search-in="payload"] .msg-payload`

test('a payload match bands the {} marker, not the label, with AA contrast and no axe issues, in every theme', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const theme of THEMES) {
    await openFindReport(page, theme)
    await page.locator('[data-diagram-find]').fill('sock-1')
    await expect(page.locator('.diagram-find-count')).toHaveText('1 of 2, 2 in payloads')
    await expect(page.locator(payloadMarker('current'))).toHaveCount(1)
    await expect(page.locator(payloadMarker('match'))).toHaveCount(1)
    await expect(
      page.locator('.msg-open[aria-label^="Open place order,"][aria-label$=", current search match in payload"]'),
    ).toHaveCount(1)
    await expect(
      page.locator('.msg-open[aria-label^="Open reserve stock,"][aria-label$=", search match in payload"]'),
    ).toHaveCount(1)
    const label = await page
      .locator('.seq-svg .search-current .msg-label')
      .evaluate((el) => getComputedStyle(el).stroke)
    expect(label, `${theme}: the label of a payload-only match is not banded`).toBe('none')
    for (const state of ['current', 'match'] as const) {
      const [text, band] = await computedColours(page, [
        [payloadMarker(state), 'fill'],
        [payloadMarker(state), 'stroke'],
      ])
      expect(contrastRatio(text, band), `${theme} ${state} {} contrast`).toBeGreaterThanOrEqual(4.5)
    }
    // A label match leaves its {} as it was.
    await page.locator('[data-diagram-find]').fill('applied')
    const marker = await page
      .locator('.seq-svg .search-current .msg-payload')
      .evaluate((el) => getComputedStyle(el).stroke)
    expect(marker, `${theme}: a label match does not band the {} marker`).toBe('none')
    await page.locator('[data-diagram-find]').fill('snowdrop')
    const violations = await seriousViolations(page)
    expect(violations, formatViolations(violations)).toEqual([])
  }
})

test('forced colours: the current payload match takes the system highlight', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await openFindReport(page, 'dark')
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.locator('[data-diagram-find]').fill('sock-1')
  await expect(page.locator(payloadMarker('current'))).toHaveCount(1)
  await page.evaluate(() => {
    const probe = document.createElement('i')
    probe.id = 'probe'
    probe.style.color = 'Highlight'
    probe.style.backgroundColor = 'HighlightText'
    document.body.append(probe)
  })
  const [stroke, fill, highlight, highlightText, other, otherText] = await computedColours(page, [
    [payloadMarker('current'), 'stroke'],
    [payloadMarker('current'), 'fill'],
    ['#probe', 'color'],
    ['#probe', 'background-color'],
    [payloadMarker('match'), 'stroke'],
    [payloadMarker('match'), 'fill'],
  ])
  expect(stroke).toEqual(highlight)
  expect(fill).toEqual(highlightText)
  expect(contrastRatio(other, otherText)).toBeGreaterThanOrEqual(4.5)
})

/** Is the current mark in the panel inside the window and inside every box around it that scrolls? */
async function currentMarkOnScreen(page: Page): Promise<string> {
  return page.evaluate(() => {
    const mark = document.querySelector<HTMLElement>('#inspector-pre mark.is-current')
    if (!mark) return 'no current mark'
    const at = mark.getBoundingClientRect()
    const bar = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0
    if (at.top < bar || at.bottom > innerHeight) return `mark at ${Math.round(at.top)}, window ${bar}–${innerHeight}`
    for (let el = mark.parentElement; el; el = el.parentElement) {
      const box = el.getBoundingClientRect()
      const clips = getComputedStyle(el).overflowY !== 'visible'
      if (clips && (at.top < box.top - 1 || at.bottom > box.bottom + 1)) return `clipped by ${el.id || el.className}`
    }
    return 'on screen'
  })
}

test('opening a payload match marks every match in the JSON and steps through them in the panel', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFindReport(page)
  await page.locator('[data-diagram-find]').fill('snowdrop')
  await page.locator('.msg-open[aria-label^="Open reserve stock"]').click()
  const panel = page.locator('#inspector')
  await expect(panel).toBeVisible()
  const marks = panel.locator('#inspector-pre mark.json-hit')
  await expect(marks).toHaveCount(3)
  await expect(panel.locator('#inspector-pre mark.is-current')).toHaveText('snowdrop')
  const count = panel.locator('.json-find-count')
  await expect(count).toHaveText('1 of 3 in payload')
  await expect.poll(() => currentMarkOnScreen(page)).toBe('on screen')
  await panel.getByRole('button', { name: 'Next match in payload' }).click()
  await expect(count).toHaveText('2 of 3 in payload')
  await expect(panel.locator('#inspector-pre mark.is-current')).toHaveText('SNOWDROP')
  await panel.getByRole('button', { name: 'Previous match in payload' }).click()
  await panel.getByRole('button', { name: 'Previous match in payload' }).click()
  await expect(count).toHaveText('3 of 3 in payload')
  // Typing a new query redraws the marks.
  await page.locator('[data-diagram-find]').fill('gift')
  await expect(marks).toHaveCount(1)
  await expect(count).toHaveText('1 of 1 in payload')
  // The text itself is unchanged: Copy and print take the JSON as it is.
  const text = await panel.locator('#inspector-pre').textContent()
  expect(JSON.parse(text!)).toMatchObject({ note: 'snowdrop gift wrap' })
  await page.locator('[data-diagram-find]').fill('')
  await expect(marks).toHaveCount(0)
  await expect(panel.locator('#inspector-find')).toBeHidden()
})

test('stepping through Find updates an open panel without taking focus, and never opens a closed one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFindReport(page)
  const find = page.locator('[data-diagram-find]')
  await find.fill('snowdrop')
  await expect(page.locator('.diagram-find-count')).toHaveText('1 of 3, 2 in payloads')
  await find.press('Enter')
  await expect(page.locator('.diagram-find-count')).toHaveText('2 of 3, 2 in payloads')
  await expect(page.locator('#inspector')).toBeHidden()

  await page.locator('.msg-open[aria-label^="Open place order"]').click()
  await expect(page.locator('#inspector-title')).toHaveText('place order')
  await expect(page.locator('#inspector-pre mark.is-current')).toHaveText('SNOWDROP')
  await find.focus()
  await find.press('Enter')
  await expect(page.locator('.diagram-find-count')).toHaveText('3 of 3, 2 in payloads')
  await expect(page.locator('#inspector-title')).toHaveText('snowdrop applied')
  await expect(find).toBeFocused()
  await page.getByRole('button', { name: 'Next match', exact: true }).click()
  await expect(page.locator('#inspector-title')).toHaveText('place order')
  await expect(page.locator('#inspector-pre mark.json-hit')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Next match', exact: true })).toBeFocused()
})

test('axe with payload marks in the panel, in every theme', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const theme of THEMES) {
    await openFindReport(page, theme)
    await page.locator('[data-diagram-find]').fill('snowdrop')
    await page.locator('.msg-open[aria-label^="Open reserve stock"]').click()
    await expect(page.locator('#inspector-pre mark.json-hit')).toHaveCount(3)
    const violations = await seriousViolations(page)
    expect(violations, `${theme}\n${formatViolations(violations)}`).toEqual([])
    for (const mark of ['mark.is-current', 'mark.json-hit:not(.is-current)']) {
      const [text, background] = await computedColours(page, [
        [`#inspector-pre ${mark}`, 'color'],
        [`#inspector-pre ${mark}`, 'background-color'],
      ])
      expect(contrastRatio(text, background), `${theme} ${mark} contrast`).toBeGreaterThanOrEqual(4.5)
    }
  }
})

test('forced colours: payload marks use the system mark and highlight colours', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFindReport(page, 'dark')
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  await page.locator('[data-diagram-find]').fill('snowdrop')
  await page.locator('.msg-open[aria-label^="Open reserve stock"]').click()
  await expect(page.locator('#inspector-pre mark.json-hit')).toHaveCount(3)
  await page.evaluate(() => {
    const probe = document.createElement('i')
    probe.id = 'probe'
    probe.style.color = 'Highlight'
    probe.style.backgroundColor = 'HighlightText'
    document.body.append(probe)
  })
  const [current, currentText, highlight, highlightText, other, otherText] = await computedColours(page, [
    ['#inspector-pre mark.is-current', 'background-color'],
    ['#inspector-pre mark.is-current', 'color'],
    ['#probe', 'color'],
    ['#probe', 'background-color'],
    ['#inspector-pre mark.json-hit:not(.is-current)', 'background-color'],
    ['#inspector-pre mark.json-hit:not(.is-current)', 'color'],
  ])
  expect(current).toEqual(highlight)
  expect(currentText).toEqual(highlightText)
  expect(other).not.toEqual(current)
  expect(contrastRatio(other, otherText)).toBeGreaterThanOrEqual(4.5)
})

test.describe('on a phone', () => {
  // The phone's screen, touch and mobile viewport in Chromium (as search-mobile.spec.ts).
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['Pixel 7']
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })
  test('tapping a payload match shows its first match on screen below the report', async ({ page }) => {
    await openFindReport(page)
    await page.locator('[data-diagram-find]').tap()
    await page.keyboard.insertText('snowdrop')
    await expect(page.locator('.diagram-find-count')).toHaveText('1 of 3, 2 in payloads')
    await page.locator('[data-diagram-find]').blur()
    await page.locator('.msg-open[aria-label^="Open reserve stock"]').tap()
    await expect(page.locator('#inspector-pre mark.json-hit')).toHaveCount(3)
    await expect.poll(() => currentMarkOnScreen(page), { timeout: 3000 }).toBe('on screen')
    const next = page.getByRole('button', { name: 'Next match in payload' })
    const box = await next.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await next.tap()
    await expect(page.locator('.json-find-count')).toHaveText('2 of 3 in payload')
    await expect.poll(() => currentMarkOnScreen(page), { timeout: 3000 }).toBe('on screen')
  })
})

test('the Payloads toggle turns payloads out of Find and back in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFindReport(page)
  const find = page.locator('[data-diagram-find]')
  const toggle = page.getByRole('button', { name: 'Payloads', exact: true })
  const count = page.locator('.diagram-find-count')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(find).toHaveAccessibleName('Find messages, notes and payloads in this diagram')
  // The toggle sits inside the field's box, so the toolbar is no wider for it.
  const [field, braces] = [(await find.boundingBox())!, (await toggle.boundingBox())!]
  expect(braces.x).toBeGreaterThan(field.x)
  expect(braces.x + braces.width).toBeLessThanOrEqual(field.x + field.width)
  await find.fill('snowdrop')
  await expect(count).toHaveText('1 of 3, 2 in payloads')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(find).toHaveAccessibleName('Find messages and notes in this diagram')
  await expect(count).toHaveText('1 of 1')
  await expect(page.locator('.seq-svg [data-search-in="payload"]')).toHaveCount(0)
  await page.locator('.msg-open[aria-label^="Open reserve stock"]').click()
  await expect(page.locator('#inspector-pre')).toBeVisible()
  await expect(page.locator('#inspector-pre mark')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(count).toHaveText('1 of 3, 2 in payloads')
  await expect(page.locator('#inspector-pre mark.json-hit')).toHaveCount(3)
})

test('a diagram without payloads has no Payloads toggle', async ({ page }) => {
  await openReport(page, { report: findReportWithoutPayloads, viewport: { width: 1280, height: 800 } })
  await expect(page.locator('[data-find-payloads]')).toHaveCount(0)
  await expect(page.locator('[data-diagram-find]')).toHaveAccessibleName('Find messages and notes in this diagram')
})
