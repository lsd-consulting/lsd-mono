import { expect, test } from '@playwright/test'
import type { Report } from '../src/types'
import { uxFixture } from './ux-fixture'
import { openReport, startPrint, endPrint } from './ux-helpers'

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
  await openReport(page, uxFixture)
  await startPrint(page)
  for (const chrome of ['.topbar', '.sidebar', '.seq-toolbar', '#inspector']) {
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
    const room =
      box.width -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      parseFloat(style.borderLeftWidth) -
      parseFloat(style.borderRightWidth)
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

test('the {} payload marker and its legend show on screen, not in print, and use CanvasText in forced colours', async ({
  page,
}) => {
  await openReport(page, uxFixture)
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
