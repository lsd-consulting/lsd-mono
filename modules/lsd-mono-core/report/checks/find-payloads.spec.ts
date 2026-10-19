import { expect, test } from '@playwright/test'
import { openFindIndex, openFindReport } from './find-fixture'
import { THEMES, computedColours, contrastRatio, formatViolations, seriousViolations } from './ux-helpers'

// Find in payloads (#60): the arrows whose payload matches count and step like label matches.

for (const [pageName, open] of Object.entries({ report: openFindReport, index: openFindIndex })) {
  test(`find (${pageName} page): payload matches count, step and are named like label matches`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await open(page)
    const find = page.locator('[data-diagram-find]')
    const count = page.locator('.diagram-find-count')
    await find.click()
    await page.keyboard.type('snowdrop', { delay: 10 })
    await expect(count).toHaveText('1 of 3, 2 in payloads')
    await expect(page.locator('.msg-open[aria-label^="Open place order, current search match"]')).toHaveCount(1)
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
    await expect(page.locator('.msg-open[aria-label="Open place order, current search match in payload"]')).toHaveCount(
      1,
    )
    await expect(page.locator('.msg-open[aria-label="Open reserve stock, search match in payload"]')).toHaveCount(1)
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
