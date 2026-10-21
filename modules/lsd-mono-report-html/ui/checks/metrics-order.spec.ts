import { devices, expect, test, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { example, openExample } from './example-report'
import { expectStable, formatViolations, seriousViolations } from './ux-helpers'
import { openReport } from './open-report'

// #95: the Timing and metrics panel reads Time by participant, Swim lanes, Waterfall, Metrics,
// then Accuracy by pair (drill-down detail) last, all H3 under the panel's H2. More than six
// pairs fold under a summary, and the card's Accuracy chip opens the panel at that section.
// Run on the live example report's scenarios.

const SCENARIOS = [
  { id: '131', title: 'Timed checkout (timing API)', pairs: 13 },
  { id: '132', title: 'Happy path: card payment', pairs: 20 },
]
const ORDER = ['Timing and metrics', 'Time by participant', 'Swim lanes', 'Waterfall', 'Metrics', 'Accuracy by pair']
const shots = process.env.LSD_SHOTS

const card = (page: Page, id: string) => page.locator(`#card-${id}`)
const metricsButton = (page: Page, id: string) =>
  card(page, id).locator('.diagram-pane:not([hidden]) .seq-toolbar [data-show-metrics]')
const chip = (page: Page, id: string, key: string) =>
  card(page, id).locator('.timing-chip', { has: page.locator('.k', { hasText: key }) })
const details = (page: Page) => page.locator('#inspector details.pair-accuracy-more')

/** The panel's headings, their level, the text before any <small>, and their top on screen. */
async function headings(page: Page) {
  return page.locator('#inspector').evaluate((panel) =>
    [...panel.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({
      level: h.tagName,
      text: (h.firstChild?.textContent ?? '').trim(),
      top: h.getBoundingClientRect().top,
      visible: h.getBoundingClientRect().height > 0,
    })),
  )
}

/** How far down its scroll box the panel (side column) or the page (stacked) is. */
async function scrolled(page: Page) {
  return page.evaluate(() => ({
    panel: document.querySelector('#inspector')!.scrollTop,
    page: window.scrollY,
  }))
}

/** Whether [selector]'s top is on screen and below the panel's sticky header. */
async function inViewUnderHead(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!.getBoundingClientRect()
    const head = document.querySelector('#inspector .inspector-head')!.getBoundingClientRect()
    return el.top >= head.bottom - 1 && el.top < innerHeight - 40
  }, selector)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    for (const scenario of SCENARIOS) {
      test(`${scenario.title}: the sections read in order, H3 under the H2, Accuracy by pair last`, async ({
        page,
      }) => {
        await openExample(page, scenario.id)
        await metricsButton(page, scenario.id).click()
        await expect(page.locator('#inspector .timing')).toBeVisible()
        const found = await headings(page)
        expect(found.map((h) => h.text)).toEqual(ORDER)
        expect(found.map((h) => h.level)).toEqual(['H2', 'H3', 'H3', 'H3', 'H3', 'H3'])
        for (let i = 1; i < found.length; i++) expect(found[i].top).toBeGreaterThan(found[i - 1].top)
        // The metrics list has a visible heading; nothing renders after Accuracy by pair.
        await expect(page.locator('#inspector h3', { hasText: /^Metrics$/ })).toBeVisible()
        const last = await page
          .locator('#inspector-metrics')
          .evaluate((host) => host.lastElementChild?.getAttribute('data-panel-section'))
        expect(last).toBe('pair-accuracy')
        // More than six pairs: folded, the summary giving the count and each level's.
        await expect(details(page)).not.toHaveAttribute('open', '')
        await expect(details(page).locator('summary')).toHaveText(
          new RegExp(`^${scenario.pairs} pairs · \\d+ \\w+(, \\d+ [\\w ]+)*$`),
        )
        if (shots && scenario.id === '132')
          await page.screenshot({ path: `${shots}/q-95-${viewport.width}-happy-metrics.png` })
      })
    }

    test('the Accuracy chip opens the panel at Accuracy by pair, unfolded; other chips open it at the top', async ({
      page,
    }) => {
      await openExample(page, '132')
      await chip(page, '132', 'Wall-clock').click()
      await expect(page.locator('#inspector .timing')).toBeVisible()
      await expect(details(page)).not.toHaveAttribute('open', '')
      // At the top: the panel is not scrolled and its first lines (the accuracy pills) are on screen.
      expect((await scrolled(page)).panel).toBe(0)
      await expect.poll(() => inViewUnderHead(page, '#inspector .timing-notes')).toBe(true)
      await page.keyboard.press('Escape')
      await expect(chip(page, '132', 'Wall-clock')).toBeFocused()

      await chip(page, '132', 'Accuracy').click()
      await expect(details(page)).toHaveAttribute('open', '')
      await expect(page.locator('#inspector .pair-accuracy li')).toHaveCount(20)
      await expect.poll(() => inViewUnderHead(page, '#inspector [data-panel-section="pair-accuracy"] h3')).toBe(true)
      // The header, with Close, stays in view.
      await expect(page.locator('#inspector-close')).toBeInViewport()
      if (shots) await page.screenshot({ path: `${shots}/q-95-${viewport.width}-happy-accuracy-chip.png` })
      // With the panel still open and scrolled down, Wall-clock or the toolbar's Metrics button
      // opens it at the top again.
      if (viewport.width > 860) {
        await chip(page, '132', 'Wall-clock').click()
        await expect.poll(async () => (await scrolled(page)).panel).toBe(0)
        await chip(page, '132', 'Accuracy').click()
        await expect.poll(() => inViewUnderHead(page, '#inspector [data-panel-section="pair-accuracy"] h3')).toBe(true)
        expect((await scrolled(page)).panel).toBeGreaterThan(0)
        await metricsButton(page, '132').click()
        await expect(page.locator('#inspector')).toBeHidden()
        await metricsButton(page, '132').click()
        await expect.poll(async () => (await scrolled(page)).panel).toBe(0)
        await chip(page, '132', 'Accuracy').click()
        await expect.poll(() => inViewUnderHead(page, '#inspector [data-panel-section="pair-accuracy"] h3')).toBe(true)
      }
      // Closing gives focus back to the chip that opened it (#86), and reopening behaves the same.
      await page.keyboard.press('Escape')
      await expect(page.locator('#inspector')).toBeHidden()
      await expect(chip(page, '132', 'Accuracy')).toBeFocused()
      await chip(page, '132', 'Accuracy').click()
      await expect(details(page)).toHaveAttribute('open', '')
      await expect.poll(() => inViewUnderHead(page, '#inspector [data-panel-section="pair-accuracy"] h3')).toBe(true)
    })
  })
}

test.describe('at 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Tab goes Close, swim-lane bars, waterfall rows, then the folded Accuracy by pair summary', async ({ page }) => {
    await openExample(page, '131')
    await metricsButton(page, '131').click()
    await page.locator('#inspector-close').focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('#inspector .lane-bar').first()).toBeFocused()
    const order = await page
      .locator('#inspector-metrics')
      .evaluate((host) =>
        [...host.querySelectorAll<HTMLElement>('button, summary, a[href], [tabindex="0"]')].map((el) =>
          el.matches('.lane-bar') ? 'lane' : el.matches('.wf-row') ? 'waterfall' : el.tagName.toLowerCase(),
        ),
      )
    const runs = order.filter((kind, i) => kind !== order[i - 1])
    expect(runs).toEqual(['lane', 'waterfall', 'summary'])
    await page.locator('#inspector .wf-row').last().focus()
    await page.keyboard.press('Tab')
    await expect(details(page).locator('summary')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(details(page)).toHaveAttribute('open', '')
  })

  test('swim-lane bars and waterfall rows still take the diagram to their message', async ({ page }) => {
    await openExample(page, '132')
    await metricsButton(page, '132').click()
    const onScreen = (id: string) =>
      page.evaluate((messageId) => {
        const btn = document.querySelector(`#card-132 .seq-window [data-message-id="${messageId}"]`)
        if (!btn) return false
        const b = btn.getBoundingClientRect()
        return b.bottom > 0 && b.top < innerHeight
      }, id)
    const lane = page.locator('#inspector .lane-bar').last()
    const laneId = (await lane.getAttribute('data-show-message'))!
    expect(await onScreen(laneId)).toBe(false)
    await lane.click()
    await expect.poll(() => onScreen(laneId)).toBe(true)
    // A message with a payload has a button to look for in the diagram.
    const withPayload = example.scenarios
      .find((s) => s.id === '132')!
      .events.filter((e) => e.kind === 'message' && e.data !== undefined)
      .map((e) => e.id)
    const row = page
      .locator('#inspector .wf-row')
      .nth(
        await page
          .locator('#inspector .wf-row')
          .evaluateAll(
            (rows, ids) => rows.findIndex((r) => ids.includes(r.getAttribute('data-show-message') ?? '')),
            withPayload,
          ),
      )
    const rowId = (await row.getAttribute('data-show-message'))!
    await row.click()
    await expect.poll(() => onScreen(rowId)).toBe(true)
  })

  test('six or fewer pairs show open, no pair data shows no section, and the panel passes axe', async ({ page }) => {
    const six: Report = {
      ...example,
      scenarios: example.scenarios.map((s) =>
        s.id === '134' ? { ...s, pairAccuracy: (s.pairAccuracy ?? []).slice(0, 6) } : s,
      ),
    }
    await openReport(page, { report: six, path: '/#scenario=134' })
    await metricsButton(page, '134').click()
    await expect(page.locator('#inspector [data-panel-section="pair-accuracy"] .pair-accuracy li')).toHaveCount(6)
    await expect(details(page)).toHaveCount(0)
    const violations = await seriousViolations(page)
    expect(violations, formatViolations(violations)).toEqual([])

    await page.locator('#scenario-nav [data-nav="133"]').click()
    await metricsButton(page, '133').click()
    await expect(page.locator('#inspector h3', { hasText: /^Metrics$/ })).toBeVisible()
    await expect(page.locator('#inspector [data-panel-section="pair-accuracy"]')).toHaveCount(0)
    await expect(page.locator('#inspector h3', { hasText: 'Accuracy by pair' })).toHaveCount(0)
  })

  test('the panel opened from the Accuracy chip, unfolded, passes axe', async ({ page }) => {
    await openExample(page, '132')
    await chip(page, '132', 'Accuracy').click()
    await expect(details(page)).toHaveAttribute('open', '')
    const violations = await seriousViolations(page)
    expect(violations, formatViolations(violations)).toEqual([])
  })

  test('print still has the metrics list only, without the timing sections or Accuracy by pair', async ({ page }) => {
    await openExample(page, '132')
    await metricsButton(page, '132').click()
    await page.emulateMedia({ media: 'print' })
    const printed = page.locator('.print-metrics')
    await expect(printed).toHaveCount(1)
    await expect(printed.locator('h3')).toHaveText('Metrics')
    await expect(printed.locator('dl.kv dt')).toHaveCount(2)
    await expect(printed).not.toContainText('Accuracy by pair')
    await expect(printed.locator('.timing')).toHaveCount(0)
    await expect(page.locator('#inspector')).toBeHidden()
  })
})

for (const width of [390, 320, 768]) {
  test.describe(`at ${width} wide`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true })

    // With smooth scrolling (no reduced motion) and a tap, as on a phone.
    test('after Metrics and Esc, the Accuracy chip still reaches Accuracy by pair', async ({ page }) => {
      await openExample(page, '132')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await metricsButton(page, '132').click()
      await expect(page.locator('#inspector .timing')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('#inspector')).toBeHidden()
      await chip(page, '132', 'Accuracy').tap()
      await expect(details(page)).toHaveAttribute('open', '')
      // The heading lands just under the panel's sticky header, and stays there.
      const heading = '#inspector [data-panel-section="pair-accuracy"] h3'
      await expect.poll(() => inViewUnderHead(page, heading), { timeout: 3000 }).toBe(true)
      // Stays: once the smooth scroll has come to rest (ten frames without a move), it is still there.
      await expectStable(
        page,
        () => page.evaluate(() => [scrollY, document.querySelector('#inspector')!.scrollTop, innerHeight]),
        { frames: 10 },
      )
      expect(await inViewUnderHead(page, heading)).toBe(true)
      await expect(page.locator(heading)).toBeInViewport()
    })
  })
}

test.describe('on a phone', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

  test('the order is the same as on the desktop', async ({ page }) => {
    await openExample(page, '131')
    await metricsButton(page, '131').click()
    expect((await headings(page)).map((h) => h.text)).toEqual(ORDER)
  })
})
