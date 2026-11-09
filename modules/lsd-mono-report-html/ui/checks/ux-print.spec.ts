import { expect, test } from '@playwright/test'
import type { Report } from '../src/types'
import { uxFixture } from './ux-fixture'
import { startPrint, endPrint } from './ux-helpers'
import { openReport } from './open-report'
import { openExample } from './example-report'

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
      stripWidth: Math.max(...strips.map((strip) => strip.querySelector('.seq-svg')!.getBoundingClientRect().width)),
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
  // Strips start at the left edge and then between lanes (#117), not every 1000px.
  expect(printed.starts[0]).toBe(printed.bodyX)
  expect(printed.starts.length).toBeGreaterThan(1)
  expect(printed.tallest).toBeLessThanOrEqual(718)
  await endPrint(page)
  await expect(page.locator('.print-slices')).toHaveCount(0)
  await expect(page.locator('.seq-stage')).toBeVisible()
})

// #117: the example's Timed checkout (14 lanes, 2141px) printed on 10 A4 pages: strips of 1000,
// 1000 and 141px (one lane over three pages), and four pages with no words, only lifelines.
test('the 14-lane example prints in balanced strips cut between lanes, every page with something on it, every label whole once', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExample(page)
  await expect(page.locator('.seq-svg').first()).toBeVisible()
  await startPrint(page)
  const diagram = page.locator('.seq-diagram').first()
  await expect(diagram.locator('.print-slices')).toBeVisible()
  const printed = await diagram.evaluate((root) => {
    const body = root.querySelector('.seq-window .seq-svg')!
    const bodyBox = body.getAttribute('viewBox')!.split(' ').map(Number)
    const bodyX = bodyBox[0]
    // The header may be fitted to the screen; the drawing's own viewBox is the printed width.
    const width = bodyBox[2]
    const lanes = [...body.querySelectorAll('.lifeline-line')].map((l) => Number(l.getAttribute('x1')) - bodyX)
    const tiles = [...root.querySelectorAll<HTMLElement>('.print-slice')].map((tile) => {
      const svg = tile.querySelector<SVGSVGElement>('.seq-svg')!
      const [x, , w] = svg.getAttribute('viewBox')!.split(' ').map(Number)
      const frame = svg.getBoundingClientRect()
      const inside = (el: Element) => {
        const r = el.getBoundingClientRect()
        return (
          r.width > 0 &&
          r.left >= frame.left - 0.5 &&
          r.right <= frame.right + 0.5 &&
          r.top >= frame.top - 0.5 &&
          r.bottom <= frame.bottom + 0.5
        )
      }
      const touches = (el: Element) => {
        const r = el.getBoundingClientRect()
        return (
          r.width > 0 && r.right > frame.left && r.left < frame.right && r.bottom > frame.top && r.top < frame.bottom
        )
      }
      const labels = [...svg.querySelectorAll('.msg-label')]
      return {
        left: x - bodyX,
        width: w,
        stripLeft: Number(tile.dataset.stripLeft),
        stripRight: Number(tile.dataset.stripRight),
        height: tile.getBoundingClientRect().height,
        words: [...svg.querySelectorAll('.msg-label, .section-title, .note-text')].filter(touches).length,
        whole: labels.map(inside),
      }
    })
    return { width, lanes, tiles, labels: body.querySelectorAll('.msg-label').length }
  })
  // Balanced: no strip is one narrow lane; logical widths within a lane's spacing of each other.
  // Use the strip edges, not the crop: a crop can widen toward a lane so a crossing label prints whole.
  const starts = [...new Set(printed.tiles.map((t) => Math.round(t.stripLeft)))]
  expect(starts).toHaveLength(3)
  const widths = [...new Map(printed.tiles.map((t) => [Math.round(t.stripLeft), t.stripRight - t.stripLeft])).values()]
  expect(Math.min(...widths)).toBeGreaterThan(printed.width / 3 - 160)
  expect(Math.max(...widths)).toBeLessThanOrEqual(1000)
  expect(Math.max(...printed.tiles.map((t) => t.width))).toBeLessThanOrEqual(1000)
  // Each logical cut falls between two lanes, well clear of either lifeline.
  for (const cut of starts.slice(1))
    expect(Math.min(...printed.lanes.map((x) => Math.abs(x - cut)))).toBeGreaterThan(40)
  // At most five diagram pages (with the summary page, six), and none without a word.
  expect(printed.tiles.length).toBeLessThanOrEqual(5)
  for (const tile of printed.tiles) expect(tile.words).toBeGreaterThan(0)
  for (const tile of printed.tiles) expect(tile.height).toBeLessThanOrEqual(718)
  // Every arrow label is whole on at least one page.
  for (let i = 0; i < printed.labels; i++)
    expect(
      printed.tiles.some((t) => t.whole[i]),
      `label ${i}`,
    ).toBe(true)
  await endPrint(page)

  // The PDF itself: six A4 pages at most (a summary page and the strips).
  const pdf = await page.pdf({ format: 'A4', printBackground: true })
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0
  expect(pages).toBeGreaterThan(1)
  expect(pages).toBeLessThanOrEqual(6)
})
