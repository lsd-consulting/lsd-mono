import { devices, expect, test, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { PAGES, sectionsReport } from './diagram-pages'
import { openReport } from './open-report'
import { uxFixture } from './ux-fixture'
import { pendingReport, scenarioPartTops } from './ux-helpers'

/**
 * The phone layout: the scenario list folds to the selected item under an "N scenarios"
 * disclosure, and search sits on one row with the status chips.
 */
const PHONES = {
  iPhone: devices['iPhone 13'],
  Pixel: devices['Pixel 7'],
} as const

// The fixture's description and facts, with a diagram tall enough to scroll through.
const tall = sectionsReport(30).scenarios[0]
const base = { ...uxFixture.scenarios[0], participants: tall.participants, events: tall.events }
const phoneReport: Report = {
  ...uxFixture,
  scenarios: ['One', 'Two', 'Three', 'Four'].map((title, i) => ({ ...base, id: `sc${i + 1}`, title })),
}

const shownNavItems = (page: Page) =>
  page
    .locator('#scenario-nav [data-nav]')
    .evaluateAll((els) =>
      els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => el.textContent?.trim().split('\n')[0]),
    )

async function open(page: Page, which: 'report' | 'index', hash = '', report: Report = phoneReport): Promise<void> {
  if (which === 'report') await openReport(page, { report, path: `/${hash}` })
  // The index fixture lists one report with one scenario, id "sections".
  else await PAGES.index(page, { ...phoneReport, scenarios: [{ ...base, id: 'sections', title: 'Sections' }] })
}

for (const [phone, device] of Object.entries(PHONES)) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = device
  test.describe(`phone layout on ${phone}`, () => {
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('the scenario list folds to the selected one; the disclosure opens it and choosing folds it again', async ({
      page,
    }) => {
      await open(page, 'report')
      const toggle = page.locator('#btn-nav-fold')
      await expect(toggle).toHaveText(/4 scenarios/)
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle).toHaveAttribute('aria-controls', 'scenario-nav')
      expect(await shownNavItems(page)).toHaveLength(1)

      await toggle.focus()
      await page.keyboard.press('Enter')
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(await shownNavItems(page)).toHaveLength(4)

      await page.locator('#scenario-nav [data-nav="sc3"]').tap()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('#scenario-title')).toHaveText('Three')
      await expect(page.locator('#scenario-nav [aria-current="true"]')).toHaveAttribute('data-nav', 'sc3')
      expect(await shownNavItems(page)).toHaveLength(1)
    })

    test('Metrics sits in the toolbar and the two view tabs share a row inside the card, as 44px touch targets', async ({
      page,
    }) => {
      await open(page, 'report')
      const toolbar = page.locator('.seq-toolbar').first()
      const bar = (await toolbar.boundingBox())!
      expect(await toolbar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
      const metrics = (await toolbar.getByRole('button', { name: 'Metrics', exact: true }).boundingBox())!
      expect(metrics.height).toBeGreaterThanOrEqual(44)
      expect(metrics.x + metrics.width).toBeLessThanOrEqual(bar.x + bar.width + 0.5)
      const card = (await page.locator('.diagram-panel').first().boundingBox())!
      const boxes = []
      for (const name of ['Sequence', 'Components']) {
        const box = (await page.getByRole('tab', { name, exact: true }).boundingBox())!
        expect(box.height, name).toBeGreaterThanOrEqual(44)
        expect(box.x, name).toBeGreaterThanOrEqual(card.x)
        expect(box.x + box.width, name).toBeLessThanOrEqual(card.x + card.width + 0.5)
        boxes.push(box)
      }
      expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1)
    })

    test('a deep link selects its scenario in the folded list, and a search lists every match', async ({ page }) => {
      await open(page, 'report', '#scenario=sc4')
      await expect(page.locator('#scenario-title')).toHaveText('Four')
      expect(await shownNavItems(page)).toHaveLength(1)
      await expect(page.locator('#scenario-nav [aria-current="true"]')).toHaveAttribute('data-nav', 'sc4')
      await page.locator('#search').fill('o')
      await expect(page.locator('#btn-nav-fold')).toBeHidden()
      expect((await shownNavItems(page)).length).toBeGreaterThan(1)
    })

    test('search and the status chips share one row, and each chip keeps its name', async ({ page }) => {
      await open(page, 'report')
      const search = await page.locator('.search-wrap').boundingBox()
      const chips = await page.locator('.filters').boundingBox()
      expect(Math.abs(search!.y + search!.height / 2 - (chips!.y + chips!.height / 2))).toBeLessThan(4)
      await expect(page.locator('.filters [data-filter="success"]')).toHaveAccessibleName(/^Success/)
    })

    for (const which of ['report', 'index'] as const) {
      test(`${which}: scrolling slides the top bar's first row away, search stays, the toolbar sticks below it, nothing jumps`, async ({
        page,
      }) => {
        await open(page, which)
        const measure = () =>
          page.evaluate(() => {
            const bar = document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect()
            const panel = document.querySelector<HTMLElement>('.diagram-panel')!.getBoundingClientRect()
            const search = document.querySelector<HTMLElement>('.search-wrap')!.getBoundingClientRect()
            const brand = document.querySelector<HTMLElement>('.brand')!.getBoundingClientRect()
            const toolbar = document.querySelector<HTMLElement>('.seq-toolbar')!.getBoundingClientRect()
            const find = document.querySelector<HTMLElement>('.diagram-find')!.getBoundingClientRect()
            return {
              findTop: find.top,
              barBottom: bar.bottom,
              barHeight: bar.height,
              panelDocTop: panel.top + scrollY,
              searchTop: search.top,
              brandBottom: brand.bottom,
              toolbarDocTop: toolbar.top + scrollY,
              stuck: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')),
            }
          })
        const before = await measure()
        expect(before.barHeight).toBeGreaterThan(80) // two rows at the top of the page
        const panelTop = before.panelDocTop
        // Well into the diagram, past where its toolbar starts.
        await page.evaluate((y) => scrollTo(0, y + 300), before.toolbarDocTop)
        await page.waitForTimeout(100)
        const after = await measure()
        expect(after.barBottom).toBeLessThanOrEqual(64)
        expect(Math.abs(after.barBottom - after.stuck)).toBeLessThanOrEqual(1)
        expect(after.brandBottom).toBeLessThanOrEqual(1)
        expect(after.searchTop).toBeGreaterThanOrEqual(0)
        // Only the toolbar's Find row stays, just under the bar.
        expect(after.findTop).toBeGreaterThanOrEqual(after.barBottom)
        expect(after.findTop).toBeLessThanOrEqual(after.barBottom + 12)
        expect(after.panelDocTop).toBe(panelTop)
        await expect(page.locator('[data-diagram-find]')).toBeInViewport()
        await expect(page.locator('[data-find-step="next"]')).toBeInViewport()
        // The Payloads toggle sits in the Find field.
        await expect(page.locator('[data-find-payloads]')).toBeInViewport()
        const toggle = await page.locator('[data-find-payloads]').boundingBox()
        const field = await page.locator('[data-diagram-find]').boundingBox()
        expect(Math.abs(toggle!.y + toggle!.height / 2 - (field!.y + field!.height / 2))).toBeLessThan(4)
        // So do the step buttons and the count, on one line.
        const next = await page.locator('[data-find-step="next"]').boundingBox()
        expect(Math.abs(next!.y + next!.height / 2 - (field!.y + field!.height / 2))).toBeLessThan(4)
      })
    }

    // Same reading order as on a desktop: what the scenario is and why it ended, then its diagram.
    test('the description, its reason and the key facts come before the diagram', async ({ page }) => {
      await open(page, 'report', '', pendingReport)
      const at = await scenarioPartTops(page)
      expect(at.description).toBeLessThan(at.error)
      expect(at.error).toBeLessThan(at.facts)
      expect(at.facts).toBeLessThan(at.diagram)
    })

    test('index: the report list folds to the open report', async ({ page }) => {
      await open(page, 'index')
      await expect(page.locator('#btn-nav-fold')).toHaveText(/1 report\b/)
      await expect(page.locator('#btn-nav-fold')).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('#scenario-nav [aria-current="true"]')).toBeVisible()
    })
  })
}

// Tall phones in portrait: past the top of the diagram, the participant header stays in view below
// the bars at every scroll position, including the very end of the page.
for (const [name, viewport] of [
  ['390x844', { width: 390, height: 844 }],
  ['412x915', { width: 412, height: 915 }],
  ['320x640', { width: 320, height: 640 }],
] as const) {
  test.describe(`participant header on a ${name} phone`, () => {
    const { userAgent, deviceScaleFactor, isMobile, hasTouch } = PHONES.iPhone
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('the sticky header sits below the top bar and Find row from the diagram top to the page end', async ({
      page,
    }) => {
      await open(page, 'report')
      const stuckHeader = () =>
        page.evaluate(() => {
          const header = document.querySelector<HTMLElement>('.seq-sticky-header')!.getBoundingClientRect()
          const toolbar = document.querySelector<HTMLElement>('.seq-toolbar')!.getBoundingClientRect()
          const bar = document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect()
          return { top: header.top, bottom: header.bottom, toolbarBottom: toolbar.bottom, barBottom: bar.bottom }
        })
      const start = await page.evaluate(
        () => document.querySelector('.seq-stage')!.getBoundingClientRect().top + scrollY,
      )
      const end = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
      for (const y of [start, start + 200, (start + end) / 2, end - 50, end]) {
        await page.evaluate((to) => scrollTo(0, to), y)
        await page.waitForTimeout(80)
        const m = await stuckHeader()
        // Once the diagram's top has reached the toolbar the header is never under it.
        if (y > start) {
          expect(m.top, `header top at scroll ${y}`).toBeGreaterThanOrEqual(m.toolbarBottom - 1)
          expect(m.top, `header top at scroll ${y}`).toBeGreaterThanOrEqual(m.barBottom - 1)
        }
        expect(m.bottom).toBeLessThanOrEqual(viewport.height)
      }
    })
  })
}

// Android phones in portrait (#113): mid-scroll the drawing reaches the bottom of the screen, with
// no empty band under it; only in the last of the page does it give up the room below the stage,
// ending with the drawing's end in view (#80).
for (const [name, viewport] of [
  ['360x780', { width: 360, height: 780 }],
  ['390x844', { width: 390, height: 844 }],
  ['412x915', { width: 412, height: 915 }],
] as const) {
  test.describe(`drawing height on a ${name} phone`, () => {
    const { userAgent, deviceScaleFactor, isMobile, hasTouch } = PHONES.Pixel
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('the drawing fills the screen down to its bottom edge while scrolling, and ends with the page', async ({
      page,
    }) => {
      await open(page, 'report')
      const drawing = () =>
        page.evaluate(() => {
          const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
          const box = scroll.getBoundingClientRect()
          const hit = document.elementFromPoint(box.left + box.width / 2, innerHeight - 4)
          return {
            bottom: box.bottom,
            stageBottom: document.querySelector('.seq-stage')!.getBoundingClientRect().bottom,
            drawnAtScreenBottom: !!hit && scroll.contains(hit),
            atDrawingEnd: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 1,
          }
        })
      const start = await page.evaluate(
        () => document.querySelector('.seq-stage')!.getBoundingClientRect().top + scrollY,
      )
      const end = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
      const room = await page.evaluate(
        () =>
          document.documentElement.scrollHeight -
          (document.querySelector('.seq-stage')!.getBoundingClientRect().bottom + scrollY),
      )
      expect(room).toBeGreaterThan(0)
      for (const y of [start + 200, (start + end) / 2, end - room - 20]) {
        await page.evaluate((to) => scrollTo(0, to), y)
        await page.waitForTimeout(80)
        const m = await drawing()
        expect(m.bottom, `drawing bottom at scroll ${y}`).toBeGreaterThanOrEqual(viewport.height - 1)
        expect(m.drawnAtScreenBottom, `drawing at the screen bottom at scroll ${y}`).toBe(true)
      }
      await page.evaluate((to) => scrollTo(0, to), end)
      await page.waitForTimeout(80)
      const m = await drawing()
      expect(Math.abs(m.bottom - m.stageBottom)).toBeLessThanOrEqual(1)
      expect(m.bottom).toBeLessThanOrEqual(viewport.height)
      expect(m.atDrawingEnd).toBe(true)
    })
  })
}

// WCAG 2.4.11 Focus Not Obscured (#113): from the top of the page, before the diagram sticks, its
// lower part is below the window. Arrowing through the messages keeps the focused one wholly on
// screen, below the sticky header and the bars, on the way down and back up.
for (const [name, viewport] of [
  ['360x780', { width: 360, height: 780 }],
  ['412x915', { width: 412, height: 915 }],
] as const) {
  test.describe(`arrowing through messages on a ${name} phone`, () => {
    const { userAgent, deviceScaleFactor, isMobile, hasTouch } = PHONES.Pixel
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    test('the focused message stays on screen below the sticky header, down from the page top and back', async ({
      page,
    }) => {
      await open(page, 'report')
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('.seq-scroll button.msg-open')!.focus({ preventScroll: true })
        scrollTo(0, 0)
      })
      await page.waitForTimeout(80)
      const focused = () =>
        page.evaluate(async () => {
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const el = document.activeElement as HTMLElement
          const box = el.getBoundingClientRect()
          const bottomOf = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().bottom
          return {
            id: el.matches('button.msg-open') ? el.dataset.messageId : `not a message: ${el.tagName}`,
            top: box.top,
            bottom: box.bottom,
            below: Math.max(bottomOf('.seq-sticky-header'), bottomOf('.seq-toolbar'), bottomOf('.topbar')),
            scrollY,
          }
        })
      const check = async (step: string) => {
        const m = await focused()
        expect(m.id, step).not.toMatch(/^not a message/)
        expect(m.top, `${step}: ${m.id} top at scroll ${m.scrollY}`).toBeGreaterThanOrEqual(m.below - 1)
        expect(m.bottom, `${step}: ${m.id} bottom at scroll ${m.scrollY}`).toBeLessThanOrEqual(viewport.height)
        // One move per press: the page does not follow on a frame later.
        await page.waitForTimeout(50)
        expect(await page.evaluate(() => scrollY), `${step}: page settled`).toBe(m.scrollY)
        return m
      }
      const steps = 24
      const ids: string[] = []
      for (let i = 1; i <= steps; i++) {
        await page.keyboard.press('ArrowDown')
        ids.push((await check(`ArrowDown ${i}`)).id!)
      }
      // Every press moved on to a new message.
      expect(new Set(ids).size).toBe(steps)
      for (let i = 1; i < steps; i++) {
        await page.keyboard.press('ArrowUp')
        expect((await check(`ArrowUp ${i}`)).id).toBe(ids[steps - 1 - i])
      }
    })
  })
}

// WCAG 2.4.11 Focus Not Obscured: on a phone the toolbar's upper rows slide under the top bar, so
// a focused Zoom button could sit entirely beneath it. Walk the whole tab order both ways.
for (const [name, viewport] of [
  ['390x844', { width: 390, height: 844 }],
  ['320x640', { width: 320, height: 640 }],
] as const) {
  test.describe(`focus on a ${name} phone`, () => {
    const { userAgent, deviceScaleFactor, isMobile, hasTouch } = PHONES.iPhone
    test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })

    const hidden = (page: Page) =>
      page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const box = el.getBoundingClientRect()
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        const seen = !!hit && (el === hit || el.contains(hit) || hit.contains(el))
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName
        return seen ? null : `${name} at y=${Math.round(box.top)}`
      })

    for (const direction of ['Tab', 'Shift+Tab'] as const) {
      test(`${direction} through the page never leaves the focused control under a bar`, async ({ page }) => {
        await open(page, 'report')
        // Start with the page scrolled to its end, where the toolbar's upper rows are stuck out of
        // sight: Shift+Tab from Find goes up into them, Tab from the scenario list comes down to them.
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(100)
        await page
          .locator(direction === 'Tab' ? '#btn-nav-fold' : '[data-diagram-find]')
          .evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }))
        const covered: string[] = []
        const seenNames = new Set<string>()
        for (let i = 0; i < 14; i++) {
          await page.keyboard.press(direction)
          await page.waitForTimeout(30)
          const issue = await hidden(page)
          if (issue) covered.push(issue)
          seenNames.add(
            await page.evaluate(
              () =>
                document.activeElement?.getAttribute('aria-label') ??
                document.activeElement?.textContent?.trim().slice(0, 20) ??
                '',
            ),
          )
        }
        for (const name of ['Zoom out', 'Zoom in', 'Overview']) {
          expect(seenNames.has(name), `the walk reached ${name}`).toBe(true)
        }
        expect(
          [...seenNames].some((name) => name.startsWith('Reset zoom, now')),
          'the walk reached the % reset',
        ).toBe(true)
        expect(covered).toEqual([])
      })
    }
  })
}

// WCAG 1.4.10 Reflow: at 320 CSS px (400% zoom) nothing in the scenario card is cut off.
test.describe('the scenario card at 320px', () => {
  const { userAgent, deviceScaleFactor, isMobile, hasTouch } = PHONES.iPhone
  test.use({ viewport: { width: 320, height: 640 }, userAgent, deviceScaleFactor, isMobile, hasTouch })

  const longFacts: Report = {
    ...uxFixture,
    scenarios: [
      {
        ...uxFixture.scenarios[0],
        facts: [
          { key: 'traceId', value: '4bf92f3577b34da6a3ce929d0e0e4736' },
          { key: 'clock ordering', value: 'same source (deferred clock ordering applied to every captured message)' },
          { key: 'orderId', value: 'ord_ux' },
        ],
        events: [
          { kind: 'section', id: 's1', title: 'Measured and traced' },
          ...sectionsReport(3).scenarios[0].events.slice(0, 4),
          { kind: 'section', id: 's2', title: 'Captured out of order, put back by the clock' },
          { kind: 'section', id: 's3', title: 'Refunds and reversals' },
        ],
        participants: sectionsReport(3).scenarios[0].participants,
      },
    ],
  }

  test('every Key facts value sits inside the card and keeps its full text', async ({ page }) => {
    await open(page, 'report', '', longFacts)
    const result = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('.scenario-card')!.getBoundingClientRect()
      const values = [...document.querySelectorAll<HTMLElement>('.kv dd')].map((dd) => {
        const box = dd.getBoundingClientRect()
        return { text: dd.textContent, right: box.right, left: box.left, scroll: dd.scrollWidth - dd.clientWidth }
      })
      const keys = [...document.querySelectorAll<HTMLElement>('.kv dt')].map((dt) => dt.getBoundingClientRect().width)
      return { cardRight: card.right, cardLeft: card.left, values, keys }
    })
    // The keys are readable too: none squeezed to nothing.
    expect(result.keys.every((width) => width > 20)).toBe(true)
    expect(result.values.map((v) => v.text)).toContain('4bf92f3577b34da6a3ce929d0e0e4736')
    for (const value of result.values) {
      expect(value.right, value.text).toBeLessThanOrEqual(result.cardRight)
      expect(value.left, value.text).toBeGreaterThanOrEqual(result.cardLeft)
      expect(value.scroll, `${value.text} clipped`).toBeLessThanOrEqual(0)
    }
  })

  test('the section buttons stay inside the card, and a focused one is fully visible', async ({ page }) => {
    await open(page, 'report', '', longFacts)
    const row = (await page.locator('.section-jump').boundingBox())!
    const buttons = page.locator('.section-jump button')
    for (let i = 0; i < (await buttons.count()); i++) {
      await buttons.nth(i).focus()
      const box = (await buttons.nth(i).boundingBox())!
      expect(box.x, `section ${i} left`).toBeGreaterThanOrEqual(row.x - 0.5)
      expect(box.x + box.width, `section ${i} right`).toBeLessThanOrEqual(row.x + row.width + 0.5)
    }
    // And nothing in the card is wider than the card.
    const wide = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('.scenario-card')!
      return [...card.querySelectorAll<HTMLElement>('*')]
        .filter((el) => !el.closest('.seq-scroll, svg, .msg-text') && el.scrollWidth - el.clientWidth > 1)
        .filter((el) => getComputedStyle(el).overflowX === 'visible')
        .map((el) => `${el.tagName}.${el.className}`)
    })
    expect(wide).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  })
})
