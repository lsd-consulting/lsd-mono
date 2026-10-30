import { expect, test } from '@playwright/test'
import type { Report } from '../src/types'
import { uxFixture } from './ux-fixture'
import { startPrint, endPrint } from './ux-helpers'
import { openReport } from './open-report'

// Print: what prints from an open panel, diagrams at page width.

/** The fixture with one long payload: a very long line and many lines. */
const longPayloadReport: Report = {
  ...uxFixture,
  scenarios: uxFixture.scenarios.map((scenario) => ({
    ...scenario,
    events: scenario.events.map((event) =>
      event.id === 'm1' && event.kind === 'message'
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

test('print leaves out the scenario list and toolbars, prints nothing from a closed panel, and draws diagrams at page width', async ({
  page,
}) => {
  await openReport(page, { report: uxFixture, theme: 'light' })
  await startPrint(page)
  for (const chrome of [
    '.topbar',
    '.sidebar',
    '.diagram-pane:not([hidden]) .seq-toolbar',
    '.diagram-tabs',
    '#inspector',
  ]) {
    await expect(page.locator(chrome), chrome).toBeHidden()
  }
  await expect(page.locator('.print-panel')).toHaveCount(0)
  await expect(page.locator('.print-metrics')).toHaveCount(0)
  // Every message, not just the rows that were in view on screen.
  await expect(page.locator('.seq-window .msg-label')).toHaveCount(14)
  const fit = await page.evaluate(() => {
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    const max = parseFloat(
      getComputedStyle(document.querySelector('.seq-diagram')!).getPropertyValue('--seq-print-max'),
    )
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
  await openReport(page, { report: longPayloadReport, theme: 'light' })
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

test('print with the Components view shown draws the component diagram whole, at page width, without the link panel', async ({
  page,
}) => {
  await openReport(page, { report: uxFixture, theme: 'light' })
  await page.getByRole('tab', { name: 'Components' }).click()
  await page.locator('.comp-scroll .edge-hit').first().click({ force: true })
  await expect(page.locator('#inspector')).toBeVisible()

  await startPrint(page)
  await expect(page.locator('#inspector')).toBeHidden()
  await expect(page.locator('.diagram-tabs')).toBeHidden()
  await expect(page.locator('.seq-diagram')).toBeHidden()
  const printed = page.locator('#card-ux .comp-scroll')
  await expect(printed.locator('.component-node')).toHaveCount(3)
  const fit = await printed.evaluate((el) => {
    const svg = el.querySelector('svg.component-diagram')!
    const box = el.getBoundingClientRect()
    const drawing = svg.getBoundingClientRect()
    const natural = parseFloat(getComputedStyle(el).getPropertyValue('--comp-natural-w'))
    return {
      left: drawing.left - box.left,
      right: box.right - drawing.right,
      width: drawing.width,
      room: el.clientWidth,
      natural,
      clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    }
  })
  expect(fit.left).toBeGreaterThanOrEqual(-0.5)
  expect(fit.right).toBeGreaterThanOrEqual(-0.5)
  expect(fit.clipped).toBe(false)
  // As wide as the page allows, up to one and a half times its drawn size.
  expect(fit.width).toBeGreaterThanOrEqual(Math.min(fit.room, fit.natural * 1.5) - 2)
  await endPrint(page)
})

test('the {} payload marker and its legend show on screen, not in print, and use CanvasText in forced colours', async ({
  page,
}) => {
  await openReport(page, { report: uxFixture, theme: 'light' })
  const marker = page.locator('.msg-payload').first()
  const legend = page.locator('.payload-legend')
  await expect(marker).toBeVisible()
  await expect(legend).toBeVisible()

  await startPrint(page)
  await expect(page.locator('.seq-window .msg-label').first()).toBeVisible()
  await expect(page.locator('.msg-payload')).not.toHaveCount(0)
  for (const hidden of await page.locator('.msg-payload').all()) await expect(hidden).toBeHidden()
  await expect(legend).toBeHidden()
  await endPrint(page)

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
  const colours = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'CanvasText'
    document.body.append(probe)
    const canvasText = getComputedStyle(probe).color
    probe.remove()
    return {
      canvasText,
      marker: getComputedStyle(document.querySelector('.msg-payload')!).fill,
      key: getComputedStyle(document.querySelector('.payload-legend-key')!).color,
    }
  })
  expect(colours.marker).toBe(colours.canvasText)
  expect(colours.key).toBe(colours.canvasText)
})

/** Fourteen lanes, like the example report: far wider than an A4 page. */
const fourteenLanes: Report = {
  ...uxFixture,
  scenarios: [
    {
      ...uxFixture.scenarios[0],
      id: 'lanes',
      title: 'Fourteen lanes',
      participants: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, name: `Service ${i}`, type: 'participant' })),
      events: Array.from({ length: 20 }, (_, i) => ({
        kind: 'message',
        id: `m${i}`,
        from: `p${i % 14}`,
        to: `p${(i + 5) % 14}`,
        label: `call ${i}`,
        type: 'synchronous',
        data: { n: i },
      })),
    },
  ],
}

// The example report has 14 participants. Shrunk to an A4 page its labels came out at about 4pt;
// now it prints at full size in strips of lanes on landscape pages, labels at 8pt or more.
test('a wide diagram prints at full size in strips of lanes that cover the whole drawing', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openReport(page, { report: fourteenLanes, theme: 'light' })
  await expect(page.locator('.seq-svg')).toBeVisible()
  await startPrint(page)
  await expect(page.locator('.print-slices')).toBeVisible()
  await expect(page.locator('.seq-stage')).toBeHidden()
  const printed = await page.evaluate(() => {
    const strips = [...document.querySelectorAll<HTMLElement>('.print-slice')]
    const width = Number(document.querySelector('.seq-header-svg')!.getAttribute('viewBox')!.split(' ')[2])
    const labels = [...document.querySelectorAll<SVGTextElement>('.print-slices .msg-label')]
    return {
      strips: strips.length,
      stripWidth: strips[0].querySelector('.seq-svg')!.getBoundingClientRect().width,
      tallest: Math.max(...strips.map((strip) => strip.getBoundingClientRect().height)),
      // Where each page's lanes start in the drawing: 0, then 1000, 2000…
      starts: [
        ...new Set(
          strips.map((strip) => Number(strip.querySelector('.seq-svg')!.getAttribute('viewBox')!.split(' ')[0])),
        ),
      ],
      bodyX: Number(document.querySelector('.seq-window .seq-svg')!.getAttribute('viewBox')!.split(' ')[0]),
      headed: strips.every((strip) => strip.querySelector('.seq-header-svg')),
      width,
      smallestPx: Math.min(...labels.map((t) => parseFloat(getComputedStyle(t).fontSize) * t.getScreenCTM()!.a)),
      page: getComputedStyle(document.querySelector('.print-slices')!).getPropertyValue('page'),
      labelCount: labels.length,
    }
  })
  expect(printed.strips).toBeGreaterThan(1)
  expect(printed.labelCount).toBeGreaterThan(10)
  // 8pt is 10.67 CSS px.
  expect(printed.smallestPx).toBeGreaterThanOrEqual(8 / 0.75)
  expect(printed.page).toBe('diagram')
  // Nothing is lost: the strips together are at least as wide as the drawing.
  expect(printed.strips * printed.stripWidth).toBeGreaterThanOrEqual(printed.width)
  // Every page carries its lanes' header and fits A4 landscape inside 10mm margins (190mm, 718px).
  expect(printed.headed).toBe(true)
  expect(printed.stripWidth).toBeLessThanOrEqual(1047)
  expect(printed.starts).toEqual(
    Array.from({ length: printed.starts.length }, (_, i) => printed.bodyX + i * printed.stripWidth),
  )
  expect(printed.starts.length * printed.stripWidth).toBeGreaterThanOrEqual(printed.width)
  expect(printed.tallest).toBeLessThanOrEqual(718)
  await endPrint(page)
  await expect(page.locator('.print-slices')).toHaveCount(0)
  await expect(page.locator('.seq-stage')).toBeVisible()
})
