import { expect, test, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { uxFixture } from './ux-fixture'
import { THEMES, openFixture, diagramOnScreen, openWide, zoomOf } from './ux-helpers'

// Diagram drawing: note colours, labels, long names, zoom and fit, deep links, tall diagrams.

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
    await expect(page).toHaveScreenshot(`theme-${theme}.png`, { clip: await diagramOnScreen(page) })
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
  await expect(page).toHaveScreenshot('fit-top-label.png', { clip: await diagramOnScreen(page) })
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
  await page.addInitScript((report) => {
    window.__LSD_REPORT__ = report
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

  // A phone-width panel stops at the 50% floor and scrolls sideways instead.
  await page.setViewportSize({ width: 390, height: 800 })
  await expect.poll(async () => (await zoomOf(page, 'wide-a')).percent).toBe(50)
  expect((await zoomOf(page, 'wide-a')).overflowX).toBeGreaterThan(0)
})

test('a scenario chosen from the list is fitted when it shows', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
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
