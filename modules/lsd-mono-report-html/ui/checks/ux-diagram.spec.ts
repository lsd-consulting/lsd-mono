import { expect, test, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { sectionsReport } from './diagram-pages'
import { uxFixture } from './ux-fixture'
import {
  THEMES,
  computedColours,
  contrastRatio,
  openFixture,
  diagramOnScreen,
  openWide,
  formatViolations,
  seriousViolations,
  zoomOf,
  painted,
} from './ux-helpers'
import { openReport } from './open-report'

// Diagram drawing: note colours, labels, long names, zoom and fit, deep links, tall diagrams.

async function noteColours(page: Page): Promise<{ card: number[]; text: number[] }> {
  const [card, text] = await computedColours(page, [
    ['.note-card', 'fill'],
    ['.note-text', 'fill'],
  ])
  return { card, text }
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

/**
 * Zoom in twice, scroll to the bottom, then Fit: the state the fit checks below look at. The fit
 * should bring the whole width and the top message label back into view.
 */
async function zoomScrollThenFit(page: Page): Promise<void> {
  await openFixture(page, 'dark')
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  await zoomIn.click()
  await zoomIn.click()
  await page.locator('.seq-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.getByRole('button', { name: /^Reset zoom/ }).click()
  await painted(page)
}

// Pixel comparisons against the macOS baselines in checks/snapshots. Font rendering differs on
// Linux, so CI leaves out tests tagged @screenshot (grepInvert in playwright.config.ts); they run
// locally. Keep layout assertions out of them so CI still checks the layout.
test('each theme draws the diagram as in its baseline', { tag: '@screenshot' }, async ({ page }) => {
  for (const theme of THEMES) {
    await openFixture(page, theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page).toHaveScreenshot(`theme-${theme}.png`, { clip: await diagramOnScreen(page) })
  }
})

test('the fitted diagram draws as in its baseline', { tag: '@screenshot' }, async ({ page }) => {
  await zoomScrollThenFit(page)
  await expect(page).toHaveScreenshot('fit-top-label.png', { clip: await diagramOnScreen(page) })
})

test('fit keeps the top message label on screen and the whole width in view', async ({ page }) => {
  await zoomScrollThenFit(page)
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
})

/** One long display name per participant shape, next to each other. */
const longNamesReport: Report = {
  ...uxFixture,
  scenarios: [
    {
      ...uxFixture.scenarios[0],
      id: 'names',
      title: 'Long names',
      participants: [
        { id: 'client', name: 'Client', alias: 'Signed-in Customer (mobile app)', type: 'ACTOR' },
        { id: 'api', name: 'Api', alias: 'Public API Gateway (rate limited)', type: 'BOUNDARY' },
        { id: 'db', name: 'Database', alias: 'Orders DB (PostgreSQL primary)', type: 'DATABASE' },
        { id: 'bus', name: 'Queue', alias: 'Kafka topic order-events.v2', type: 'QUEUE' },
        { id: 'basket', name: 'Basket', alias: 'Shopping Basket Aggregate', type: 'ENTITY' },
        {
          id: 'svc',
          name: 'Svc',
          alias: 'Customer Notification Preferences and Delivery Orchestration Service',
          type: 'PARTICIPANT',
        },
        { id: 'stock', name: 'Inventory Service', type: 'PARTICIPANT' },
      ],
    },
  ],
}

test('long participant names stay inside their shapes and clear of their neighbours', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await openReport(page, { report: longNamesReport })
  await expect(page.locator('.seq-header-svg')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<SVGGElement>('.seq-header-svg .participant-box')].map((g) => {
      const label = g.querySelector<SVGTextElement>('.participant-label')!.getBBox()
      const shape = g.querySelector<SVGGraphicsElement>('.participant-shape, .participant-actor')!.getBBox()
      const header = g.ownerSVGElement!.viewBox.baseVal
      const x = Number(/translate\(([-\d.]+)/.exec(g.getAttribute('transform')!)![1])
      return {
        id: g.dataset.participant!,
        type: g.dataset.participantType!,
        title: g.querySelector('title')!.textContent,
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
  await expect(page.locator('.seq-header-svg')).toHaveAttribute(
    'aria-label',
    /Customer Notification Preferences and Delivery Orchestration Service/,
  )
  expect(boxes.find((box) => box.id === 'stock')!.lines).toBe(1)
})

// Fit stops at 95%, where 11px labels are still above 10px, so only a diagram a little wider than its
// panel (this one is about 1250px) fits; a wider one scrolls sideways instead.
test('a wide diagram opens fitted, refits on resize until the user zooms, then keeps their zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1250, height: 800 })
  await openWide(page)
  const first = await zoomOf(page, 'wide-a')
  expect(first.percent, 'opens below 100%, fitted to the panel').toBeLessThan(100)
  expect(first.overflowX, 'nothing to scroll sideways').toBeLessThanOrEqual(0)

  // Not zoomed yet: a narrower window refits.
  await page.setViewportSize({ width: 1235, height: 800 })
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
  await page.setViewportSize({ width: 1250, height: 800 })
  await card.getByRole('button', { name: /^Reset zoom/ }).click()
  const fitted = (await zoomOf(page, 'wide-a')).percent
  await page.setViewportSize({ width: 1235, height: 800 })
  await expect.poll(async () => (await zoomOf(page, 'wide-a')).percent).toBeLessThan(fitted)
  expect((await zoomOf(page, 'wide-a')).overflowX).toBeLessThanOrEqual(0)

  // A phone-width panel stops at the 95% floor and scrolls sideways instead.
  await page.setViewportSize({ width: 390, height: 800 })
  await expect.poll(async () => (await zoomOf(page, 'wide-a')).percent).toBe(95)
  expect((await zoomOf(page, 'wide-a')).overflowX).toBeGreaterThan(0)
})

test('a scenario chosen from the list is fitted when it shows', async ({ page }) => {
  await page.setViewportSize({ width: 1250, height: 800 })
  await openWide(page)
  await page.locator('#scenario-nav [data-nav="wide-b"]').click()
  await expect(page.locator('#card-wide-b .seq-svg')).toBeVisible()
  const opened = await zoomOf(page, 'wide-b')
  expect(opened.percent).toBeLessThan(100)
  expect(opened.overflowX).toBeLessThanOrEqual(0)
})

test('a deep link to a message in another scenario shows it, fitted, scrolls to the message and opens it', async ({
  page,
}) => {
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
    return {
      top: b.top,
      bottom: b.bottom,
      visibleTop: header.getBoundingClientRect().bottom,
      visibleBottom: scroll.getBoundingClientRect().bottom,
    }
  })
  expect(placed.top).toBeGreaterThanOrEqual(placed.visibleTop - 1)
  expect(placed.bottom).toBeLessThanOrEqual(placed.visibleBottom + 1)
})

test('a tall diagram grows the page: page scroll drives the diagram, header stays, rows stay windowed, no minimap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openFixture(page, 'dark')
  const scroll = page.locator('.seq-scroll')
  const start = await scroll.evaluate((el: HTMLElement) => ({
    content: el.scrollHeight,
    port: el.clientHeight,
    bar: el.offsetWidth - el.clientWidth,
    stage: el.closest('.seq-stage')!.getBoundingClientRect().height,
    overflowY: getComputedStyle(el).overflowY,
  }))
  expect(start.content, 'the fixture is taller than the screen').toBeGreaterThan(start.port)
  expect(start.overflowY).toBe('hidden')
  expect(start.bar).toBe(0)
  expect(start.stage).toBeGreaterThanOrEqual(start.content)

  const stageTop = await page.locator('.seq-stage').evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
  await page.evaluate((y) => window.scrollTo(0, y), stageTop + 150)
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
  const mid = await page.evaluate(() => {
    const header = document.querySelector('.seq-sticky-header')!.getBoundingClientRect()
    const topbar = document.querySelector('.topbar')!.getBoundingClientRect()
    return {
      headerTop: header.top,
      headerBottom: header.bottom,
      topbarBottom: topbar.bottom,
      painted: document.querySelectorAll('.seq-window svg').length,
    }
  })
  expect(mid.headerTop, 'the participant header sticks under the top bar').toBeGreaterThanOrEqual(mid.topbarBottom - 1)
  expect(mid.headerBottom).toBeLessThan(720)
  expect(mid.painted, 'rows are still painted in a window').toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/tall-diagram-scrolled.png' })

  // The diagram has no minimap, on desktop or phone.
  await expect(page.locator('.seq-minimap')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/tall-diagram-end.png' })
})

// The drawing is hidden from assistive tech; the text view and the payload buttons are what it gets.
test('every message is in the accessibility tree with from, to and kind, and the heading is plain', async ({
  page,
}) => {
  await openFixture(page, 'dark')
  await expect(page.getByRole('heading', { name: 'Sequence diagram', exact: true })).toBeVisible()
  const items = page.getByRole('list', { name: 'Messages in order' }).getByRole('listitem')
  const texts = await items.allTextContents()
  const messages = texts.filter((text) => !text.startsWith('Note:'))
  expect(messages).toHaveLength(14)
  expect(messages[0]).toBe('Client to Api, call: place order, has payload')
  expect(messages[2]).toBe('Database to Api, reply: ok 2, has payload')
  // Diagram order: the note sits between the third and fourth message.
  expect(texts[3]).toMatch(/^Note: Card is charged/)
  // The payload buttons say who calls whom and make no position claim with gaps.
  const button = page.locator('button.msg-open').first()
  await expect(button).toHaveAccessibleName('Open place order, Client to Api, call, has payload')
  await expect(page.locator('.msg-places [aria-posinset]')).toHaveCount(0)
  expect(await seriousViolations(page)).toEqual([])
})

// The example report has 14 participants, so Fit used to land at 50% with 5.5px labels.
for (const [name, viewport] of [
  ['1280x800', { width: 1280, height: 800 }],
  ['1440x900', { width: 1440, height: 900 }],
  ['390x844', { width: 390, height: 844 }],
] as const) {
  test(`the example report opens with readable labels at ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.locator('.seq-svg')).toBeVisible()
    await expect(page.locator('.msg-label').first()).toBeVisible()
    const smallest = await page.evaluate(() =>
      Math.min(
        ...[...document.querySelectorAll<SVGTextElement>('.seq-svg .msg-label')].map(
          (text) => Number.parseFloat(getComputedStyle(text).fontSize) * text.getScreenCTM()!.a,
        ),
      ),
    )
    expect(smallest, 'message label size in CSS px').toBeGreaterThanOrEqual(10)

    // Lanes beyond the right edge are announced, and Find brings a label from there into view.
    // A phone says so in the toolbar instead of over the drawing (#93).
    const scroll = page.locator('.seq-scroll')
    const cue = page.locator(viewport.width <= 560 ? '.seq-toolbar .seq-more-lanes' : '.seq-more span')
    const overflow = await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)
    if (overflow <= 0) {
      await expect(cue).toBeHidden()
      return
    }
    await expect(cue).toBeVisible()
    await expect(cue).toContainText('More lanes')
    const far = await page.evaluate(() => {
      const port = document.querySelector('.seq-scroll')!.getBoundingClientRect()
      const labels = [...document.querySelectorAll<SVGTextElement>('.seq-svg .msg-label')]
      return labels.find((text) => text.getBoundingClientRect().left > port.right)?.textContent?.trim() ?? null
    })
    expect(far, 'a painted label beyond the right edge').not.toBeNull()
    await page.locator('[data-diagram-find]').fill(far!.split(/\s/)[0])
    await page.keyboard.press('Enter')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const port = document.querySelector('.seq-scroll')!.getBoundingClientRect()
          const hit = document.querySelector('.seq-svg [data-search-hit="current"] .msg-label')
          const box = hit?.getBoundingClientRect()
          return !!box && box.left >= port.left - 1 && box.right <= port.right + 1
        }),
      )
      .toBe(true)
  })
}

test('section titles are headings in the text view, and axe stays clean with sections', async ({ page }) => {
  await openReport(page, { report: sectionsReport(6) })
  const list = page.getByRole('list', { name: 'Messages in order' })
  await expect(list.getByRole('heading', { level: 4 }).first()).toBeAttached()
  expect(await list.getByRole('heading', { level: 4 }).count()).toBeGreaterThan(0)
  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
})
