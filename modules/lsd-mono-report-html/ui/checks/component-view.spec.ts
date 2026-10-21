import { expect, test, type Page } from '@playwright/test'
import { conformanceReport } from '../src/lib/conformance.test-util'
import { openReport } from './open-report'
import { wideReport } from './wide-sample'
import { uxFixture } from './ux-fixture'
import type { MessageEvent, Report } from '../src/types'
import { expectStable, seriousViolations } from './ux-helpers'

// #105: the component diagram is the diagram area's other view, behind Sequence | Components tabs.

/** The live example report's first scenario (14 components), as kitchenSinkSample writes it. */
const example = conformanceReport('example-components')

const tab = (page: Page, name: 'Sequence' | 'Components') => page.getByRole('tab', { name, exact: true })
const pane = (page: Page) => page.locator('.diagram-pane[data-pane="components"]')

async function showComponents(page: Page): Promise<void> {
  await tab(page, 'Components').click()
  await expect(pane(page)).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('the tabs name the view, select with Enter or Space, and only the selected one is a tab stop', async ({
  page,
}) => {
  await openReport(page, { report: example })
  const list = page.getByRole('tablist', { name: 'Diagram' })
  await expect(list.getByRole('tab')).toHaveText(['Sequence', 'Components'])
  await expect(tab(page, 'Sequence')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.diagram-panel h3')).toHaveText('Sequence diagram')
  await expect(page.locator('[role="toolbar"] [role="tablist"]')).toHaveCount(0)
  await expect(page.locator('[data-show-components]')).toHaveCount(0)
  const panel = page.getByRole('tabpanel')
  await expect(panel).toHaveAttribute('id', (await tab(page, 'Sequence').getAttribute('aria-controls'))!)

  await tab(page, 'Sequence').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tab(page, 'Components')).toBeFocused()
  // Manual activation: moving does not select.
  await expect(tab(page, 'Sequence')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(tab(page, 'Components')).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, 'Components')).toBeFocused()
  await expect(page.locator('.diagram-panel h3')).toHaveText('Component diagram')
  await expect(panel).toHaveAttribute('aria-labelledby', 'diagram-tab-components')
  // The zoom it is shown at: the whole graph fitted (#120).
  const shownAt = await page.locator('.comp-toolbar [data-zoom="reset"]').textContent()
  await expect(page.locator('.diagram-view-status')).toHaveText(
    `Component diagram, 14 components, 13 links, zoom ${shownAt}. Too small to read: press Shift+0.`,
  )
  expect(shownAt).not.toBe('100%')
  await expect(tab(page, 'Components')).toHaveAttribute('tabindex', '0')
  await expect(tab(page, 'Sequence')).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press(' ')
  await expect(tab(page, 'Sequence')).toHaveAttribute('aria-selected', 'true')
})

test('in Components view the sequence-only controls are gone, and Tab goes tabs, zoom, Metrics, links', async ({
  page,
}) => {
  await openReport(page, { report: example })
  await showComponents(page)
  for (const selector of [
    '[data-hide-participant]',
    '[data-participant-menu]',
    '[data-diagram-find]',
    '[data-find-payloads]',
    '[data-find-step]',
    '.section-jump',
    '[data-more-lanes]',
    '.payload-legend',
  ]) {
    await expect(page.locator(selector).filter({ visible: true }), selector).toHaveCount(0)
  }
  await expect(page.locator('.diagram-hint')).toHaveText(
    'Zoom and overview (a click there zooms in) · links list their messages',
  )
  await tab(page, 'Components').focus()
  const stops: string[] = []
  for (let i = 0; i < 8 && stops.at(-1) !== 'link'; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      const el = document.activeElement!
      if (el.closest('.zoom-controls')) return 'zoom'
      if (el.matches('[data-show-metrics]')) return 'metrics'
      if (el.matches('.edge-group')) return 'link'
      if (el.matches('.comp-scroll')) return 'drawing'
      return el.className || el.tagName
    })
    if (stops.at(-1) !== stop) stops.push(stop)
  }
  // There is no Metrics button without metrics; the drawing is a stop (a named region) while it overflows, to scroll it.
  const metrics = (await page.locator('.comp-toolbar [data-show-metrics]').count()) > 0
  const overflows = await page.locator('.comp-scroll').evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  expect(stops).toEqual(['zoom', ...(metrics ? ['metrics'] : []), ...(overflows ? ['drawing'] : []), 'link'])
})

test('a link opens the side panel with its interactions, Esc gives focus back to it, and Show in sequence goes to the message', async ({
  page,
}) => {
  await openReport(page, { report: example })
  await showComponents(page)
  // At 1:1: in the fit, too small to read, Enter zooms to the link instead (#120, actual-size.spec).
  await zoomButton(page, '1:1 actual size, readable').click()
  const link = page.locator('.comp-scroll .edge-group').first()
  await link.focus()
  await page.keyboard.press('Enter')
  const inspector = page.locator('#inspector')
  await expect(inspector).toBeVisible()
  await expect(page.locator('#inspector-title')).toHaveText(/^\S.* → \S/)
  const shows = inspector.getByRole('button', { name: /^Show in sequence/ })
  await expect(shows.first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(inspector).toBeHidden()
  await expect(link).toBeFocused()

  // A straight up-and-down link has no width: Playwright would call it hidden.
  await link.click({ force: true })
  await shows.first().click()
  await expect(tab(page, 'Sequence')).toHaveAttribute('aria-selected', 'true')
  await expect(inspector).toBeVisible()
  await expect(page.locator('#inspector-title')).not.toContainText('→')
  expect(page.url()).toContain('#msg=')
})

test('the view is in the URL without a history entry, reloads, and sticks across scenarios', async ({ page }) => {
  await openReport(page, {})
  const before = await page.evaluate(() => history.length)
  await showComponents(page)
  expect(new URL(page.url()).hash).toMatch(/^#scenario=[^&]+&view=components$/)
  expect(await page.evaluate(() => history.length)).toBe(before)
  await page.reload()
  await expect(tab(page, 'Components')).toHaveAttribute('aria-selected', 'true')
  await expect(pane(page)).toBeVisible()

  // The next scenario with links opens in Components too.
  await page.locator('#scenario-title').focus()
  await page.keyboard.press('j')
  await expect(page.locator('.scenario-card')).toBeVisible()
  const hasLinks = await page.locator('.diagram-pane[data-pane="components"]').count()
  if (hasLinks) await expect(tab(page, 'Components')).toHaveAttribute('aria-selected', 'true')

  const id = new URL(page.url()).hash.match(/^#scenario=([^&]+)/)?.[1]
  await page.goto(`/#scenario=${id}`)
  await expect(tab(page, 'Sequence')).toHaveAttribute('aria-selected', 'true')
})

test('switching views keeps the sequence diagram where it was: zoom, scroll, hidden lane, Find and focus', async ({
  page,
}) => {
  await openReport(page, {})
  const seq = page.locator('.seq-scroll')
  await page.locator('.seq-toolbar [data-zoom="in"]').filter({ visible: true }).click()
  const head = page.locator('.participant-heads .participant-head').last()
  await head.hover()
  await head.locator('[data-hide-participant]').click()
  await page.locator('[data-diagram-find]').fill('order')
  await page.locator('button.msg-open').nth(2).focus()
  await page.mouse.wheel(0, 300)
  const place = () =>
    seq.evaluate((el) => ({
      top: el.scrollTop,
      left: el.scrollLeft,
      page: window.scrollY,
      zoom: document.querySelector('.seq-toolbar [data-zoom="reset"]')!.textContent,
      stop: el.querySelector('button.msg-open[tabindex="0"]')?.getAttribute('data-message-id'),
      hidden: document.querySelectorAll('.participant-heads .participant-head').length,
    }))
  // The wheel scroll has come to rest.
  const before = await expectStable(page, place)
  // A plain click would first scroll the page up to the tabs, and the diagram, which scrolls
  // with the page, would rightly follow it back to its top: switch where the page is.
  await tab(page, 'Components').dispatchEvent('click')
  await expect(pane(page)).toBeVisible()
  await page.mouse.wheel(0, 200)
  await tab(page, 'Sequence').dispatchEvent('click')
  const after = await place()
  expect(after.zoom).toBe(before.zoom)
  expect(after.stop).toBe(before.stop)
  expect(after.hidden).toBe(before.hidden)
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2)
  expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(2)
  await expect(page.locator('[data-diagram-find]')).toHaveValue('order')
  // And the Components view is where it was left.
  await showComponents(page)
  await expect(page.locator('.diagram-view-status')).toContainText(
    `zoom ${await page.locator('.comp-toolbar [data-zoom="reset"]').textContent()}`,
  )
})

test('printing with Components selected prints the component diagram instead of the sequence diagram', async ({
  page,
}) => {
  await openReport(page, { report: example })
  await showComponents(page)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.comp-scroll .component-diagram')).toBeVisible()
  await expect(page.locator('.seq-diagram')).toBeHidden()
  const width = await page
    .locator('.comp-scroll .component-diagram')
    .evaluate((svg) => svg.getBoundingClientRect().width)
  const card = await page.locator('.diagram-panel').evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBeGreaterThan(card * 0.8)
})

for (const width of [1440, 390]) {
  test(`no serious axe violations in either view at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 })
    await openReport(page, { report: example })
    expect(await seriousViolations(page)).toEqual([])
    await showComponents(page)
    expect(await seriousViolations(page)).toEqual([])
  })
}

test('without links, Components says why to a screen reader, a link to it falls back with a clean URL, and no metrics means no Metrics button', async ({
  page,
}) => {
  const first = example.scenarios[0]
  const solo = { ...first, id: 'solo', metrics: [], events: first.events.filter((e) => e.kind !== 'message') }
  await openReport(page, {
    report: { ...example, scenarios: [solo] },
    path: '/#scenario=solo&view=components',
    wait: 'none',
  })
  await expect(tab(page, 'Sequence')).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, 'Components')).toHaveAttribute('aria-disabled', 'true')
  await expect(tab(page, 'Components')).toHaveAccessibleDescription('No messages between components')
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#scenario=solo')
  await expect(page.locator('[data-show-metrics]')).toHaveCount(0)
  await expect(page.locator('.panel-controls')).toHaveCount(0)
})

// The same Zoom group as the sequence diagram (#94), for the Components view.
const zoomGroup = (page: Page) => page.locator('.comp-toolbar .zoom-controls')
const zoomButton = (page: Page, name: string) => zoomGroup(page).getByRole('button', { name, exact: true })
const readout = (page: Page) => zoomGroup(page).locator('[data-zoom="reset"]')
const status = (page: Page) => page.locator('.diagram-view-status')

/** A call chain [n] services deep: one component per rank, so its single column is one node wide (#121). */
function chainReport(n: number): Report {
  const id = (i: number) => `s${i}`
  return {
    ...uxFixture,
    scenarios: [
      {
        ...uxFixture.scenarios[0],
        id: 'chain',
        title: 'Call chain',
        participants: Array.from({ length: n }, (_, i) => ({ id: id(i), name: `Service ${i}`, type: 'PARTICIPANT' })),
        events: Array.from({ length: n - 1 }, (_, i): MessageEvent => ({
          ...(uxFixture.scenarios[0].events[0] as MessageEvent),
          id: `c${i}`,
          from: id(i),
          to: id(i + 1),
          label: `call ${i}`,
        })),
      },
    ],
  }
}

/** The drawing's scroll range, the smallest name in CSS px, and the components wholly in view. */
function drawing(page: Page) {
  return page.locator('.comp-scroll').evaluate((el) => {
    const box = el.getBoundingClientRect()
    const nodes = [...el.querySelectorAll('.component-node')].map((node) => node.getBoundingClientRect())
    const names = [...el.querySelectorAll<SVGTextElement>('.component-node text')].map(
      (text) => Number.parseFloat(getComputedStyle(text).fontSize) * text.getScreenCTM()!.a,
    )
    return {
      overX: el.scrollWidth - el.clientWidth,
      overY: el.scrollHeight - el.clientHeight,
      left: el.scrollLeft,
      top: el.scrollTop,
      smallest: Math.min(...names),
      inView: nodes.filter(
        (n) => n.left >= box.left - 1 && n.right <= box.right + 1 && n.top >= box.top - 1 && n.bottom <= box.bottom + 1,
      ).length,
      total: nodes.length,
    }
  })
}

test('the Components view zooms with the same group: it opens whole, 1:1 has 11px names, Overview fits both ways, Esc goes back', async ({
  page,
}) => {
  await openReport(page, { report: example })
  const sequenceZoom = await page.locator('.seq-toolbar [data-zoom="reset"]').first().textContent()
  await showComponents(page)
  await expect(zoomGroup(page).getByRole('button')).toHaveCount(5)
  // The example (1091 × 928) is taller than the room at 1440 × 900: it opens fitted whole (#120).
  const opened = await drawing(page)
  expect(opened.overX).toBeLessThanOrEqual(0)
  expect(opened.overY).toBeLessThanOrEqual(0)
  expect(opened.inView).toBe(14)
  const fitText = (await readout(page).textContent())!
  expect(Number.parseInt(fitText, 10)).toBeLessThan(100)
  const overview = zoomButton(page, 'Overview')
  await expect(overview).toHaveAttribute('aria-disabled', 'true')

  // 1:1: names at 11px (#91), and Overview has something to do.
  await zoomButton(page, '1:1 actual size, readable').click()
  await expect(readout(page)).toHaveText('100%')
  expect((await drawing(page)).smallest).toBeGreaterThanOrEqual(11)
  await expect(overview).not.toHaveAttribute('aria-disabled')
  await page.locator('.comp-scroll').evaluate((el) => el.scrollTo({ left: 40, top: 30 }))
  const before = await drawing(page)
  await overview.click()
  await expect(overview).toHaveAttribute('aria-pressed', 'true')
  // On, it stays enabled: a mode the button (or Esc) leaves.
  await expect(overview).not.toHaveAttribute('aria-disabled')
  const fitted = await drawing(page)
  expect(fitted.overX).toBeLessThanOrEqual(0)
  expect(fitted.overY).toBeLessThanOrEqual(0)
  expect(fitted.inView).toBe(14)
  await expect(readout(page)).toHaveText(fitText)
  await expect(status(page)).toHaveText(/^Overview, \d+%, whole diagram\. Too small to read: press Shift\+0\.$/)
  if (process.env.LSD_SHOTS)
    await page.screenshot({ path: `${process.env.LSD_SHOTS}/105-1440-components-overview.png` })

  // Esc leaves Overview, back to 100% where it was; the side panel is not involved.
  await overview.focus()
  await page.keyboard.press('Escape')
  await expect(overview).toHaveAttribute('aria-pressed', 'false')
  await expect(readout(page)).toHaveText('100%')
  const back = await drawing(page)
  expect(Math.abs(back.left - before.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(back.top - before.top)).toBeLessThanOrEqual(1)
  await expect(status(page)).toHaveText('Overview off, zoom 100%')

  // + keeps the middle of the view in place; 0 goes back to the fit.
  const middle = () =>
    page.locator('.comp-scroll').evaluate((el) => {
      const zoom =
        Number.parseFloat(el.style.getPropertyValue('--comp-w')) /
        Number.parseFloat(
          el.style.getPropertyValue('--comp-natural-w') || getComputedStyle(el).getPropertyValue('--comp-natural-w'),
        )
      return { x: (el.scrollLeft + el.clientWidth / 2) / zoom, y: (el.scrollTop + el.clientHeight / 2) / zoom }
    })
  await page.locator('.comp-scroll').evaluate((el) => el.scrollTo({ left: 60, top: 60 }))
  const centre = await middle()
  await zoomButton(page, 'Zoom in').click()
  await expect(readout(page)).toHaveText('110%')
  await expect(status(page)).toHaveText('Zoom 110%')
  const kept = await middle()
  expect(Math.abs(kept.x - centre.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(kept.y - centre.y)).toBeLessThanOrEqual(2)
  await readout(page).click()
  await expect(readout(page)).toHaveText(fitText)
  await expect(status(page)).toHaveText(`Default zoom, ${fitText}. Too small to read: press Shift+0.`)

  // The sequence diagram's zoom did not move.
  await tab(page, 'Sequence').click()
  await expect(page.locator('.seq-toolbar [data-zoom="reset"]').first()).toHaveText(sequenceZoom!)
})

test('in the Components view the zoom keys and Ctrl+wheel zoom it, and a click in Overview goes to 1:1 there', async ({
  page,
}) => {
  await openReport(page, { report: example })
  await showComponents(page)
  const fitText = (await readout(page).textContent())!
  const link = page.locator('.comp-scroll .edge-group').first()
  await link.focus()
  await page.keyboard.press('Shift+Digit0')
  await expect(readout(page)).toHaveText('100%')
  await page.keyboard.press('-')
  await expect(readout(page)).toHaveText('90%')
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await expect(readout(page)).toHaveText('110%')
  await page.keyboard.press('0')
  await expect(readout(page)).toHaveText(fitText)
  await page.keyboard.press('Shift+Digit0')
  await expect(readout(page)).toHaveText('100%')
  // The link keeps focus, and no side panel opened.
  await expect(link).toBeFocused()
  await expect(page.locator('#inspector')).toBeHidden()

  const scroller = page.locator('.comp-scroll')
  const box = (await scroller.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 100)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 100)
  await page.keyboard.up('Control')
  await expect(readout(page)).toHaveText('90%')

  await link.focus()
  await page.keyboard.press('Shift+!')
  await expect(zoomButton(page, 'Overview')).toHaveAttribute('aria-pressed', 'true')
  // A click on the drawing in Overview: 1:1, centred on the point, and no link panel.
  const node = page.locator('.comp-scroll .component-node').last()
  // The whole drawing is in its scrollport; the page brings the scrollport's foot on screen.
  await node.scrollIntoViewIfNeeded()
  const target = (await node.boundingBox())!
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
  await expect(readout(page)).toHaveText('100%')
  await expect(page.locator('#inspector')).toBeHidden()
  const centred = await node.evaluate((el) => {
    const n = el.getBoundingClientRect()
    const s = el.closest('.comp-scroll')!.getBoundingClientRect()
    return n.left >= s.left && n.right <= s.right && n.top >= s.top && n.bottom <= s.bottom
  })
  expect(centred).toBe(true)
})

test('a drawing that already fits has Overview disabled, and Shift+1 says so', async ({ page }) => {
  await openReport(page, {})
  await showComponents(page)
  const overview = zoomButton(page, 'Overview')
  await expect(overview).toHaveAttribute('aria-disabled', 'true')
  await expect(overview).toHaveAttribute('title', 'Whole diagram already fits')
  await zoomButton(page, 'Zoom out').focus()
  await page.keyboard.press('Shift+!')
  await expect(status(page)).toHaveText('Whole diagram already fits, zoom 100%')
  await expect(overview).toHaveAttribute('aria-pressed', 'false')
})

test('the 100-component sample wraps into columns: it opens whole at 1440, and Overview shows all of it (#115, #120)', async ({
  page,
}) => {
  await openReport(page, { report: wideReport(100, 400) })
  await showComponents(page)
  // The drawing is about as wide as tall now, not an 888 × 9048 px spire.
  const natural = await page.locator('.comp-scroll svg').evaluate((svg) => ({
    w: Number(svg.getAttribute('width')),
    h: Number(svg.getAttribute('height')),
  }))
  expect(natural.h / natural.w).toBeLessThan(2)
  // #120 opens Components fitted: here that is the whole drawing, above the 10% floor.
  expect(Number.parseInt((await readout(page).textContent())!, 10)).toBeGreaterThan(10)
  expect((await drawing(page)).inView).toBe(100)
  await zoomButton(page, '1:1 actual size, readable').click()
  await zoomButton(page, 'Overview').click()
  await expect(status(page)).toHaveText(/^Overview, \d+%, whole diagram\. Too small to read: press Shift\+0\.$/)
  const zoom = Number.parseInt((await readout(page).textContent())!, 10)
  expect(zoom).toBeGreaterThan(10)
  const shown = await drawing(page)
  expect(shown.total).toBe(100)
  expect(shown.inView).toBe(100)
  expect(shown.overX).toBeLessThanOrEqual(0)
  expect(shown.overY).toBeLessThanOrEqual(0)
  if (process.env.LSD_SHOTS) await page.screenshot({ path: `${process.env.LSD_SHOTS}/115-1440-overview.png` })
})

test('the 100-component sample at 100%: 11px names, and a link between columns opens its panel from the keyboard (#115)', async ({
  page,
}) => {
  await openReport(page, { report: wideReport(100, 400) })
  await showComponents(page)
  // #120 opens it fitted; 1:1 is the readable size.
  await zoomButton(page, '1:1 actual size, readable').click()
  await expect(readout(page)).toHaveText('100%')
  expect((await drawing(page)).smallest).toBeGreaterThanOrEqual(11)
  // A link whose ends sit in different columns: it runs up and across, from the foot of one column.
  const across = await page.locator('.comp-scroll .edge-group').evaluateAll((groups) => {
    const x = (id: string) => {
      const node = document.querySelector(`.component-node[data-component="${id}"]`)!
      return node.getBoundingClientRect().left
    }
    const i = groups.findIndex(
      (g) => Math.abs(x(g.getAttribute('data-edge-from')!) - x(g.getAttribute('data-edge-to')!)) > 600,
    )
    return i
  })
  expect(across).toBeGreaterThanOrEqual(0)
  const link = page.locator('.comp-scroll .edge-group').nth(across)
  await link.focus()
  await expect(link).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#inspector')).toBeVisible()
  await expect(page.locator('#inspector-title')).toContainText(' → ')
})

test('the zoom stays with its scenario: another scenario opens at 100%, and back again keeps it', async ({ page }) => {
  await openReport(page, {})
  await showComponents(page)
  await zoomButton(page, 'Zoom out').click()
  await expect(readout(page)).toHaveText('90%')
  await page.locator('#scenario-title').focus()
  await page.keyboard.press('j')
  await expect(page.locator('.comp-toolbar [data-zoom="reset"]')).toHaveText('100%')
  await page.keyboard.press('k')
  await expect(readout(page)).toHaveText('90%')
  const width = await page.locator('.comp-scroll svg').evaluate((svg) => svg.getBoundingClientRect().width)
  const natural = await page
    .locator('.comp-scroll')
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).getPropertyValue('--comp-natural-w')))
  expect(Math.abs(width - natural * 0.9)).toBeLessThanOrEqual(1)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
  })

  test('the 100-component sample is one column: Overview reaches the floor, and the rest is down, never sideways (#115, #121)', async ({
    page,
  }) => {
    await openReport(page, { report: wideReport(100, 400) })
    await tab(page, 'Components').tap()
    await expect(pane(page)).toBeVisible()
    // One column, the spire it was before #115: many times taller than wide.
    const natural = await page.locator('.comp-scroll svg').evaluate((svg) => ({
      w: Number(svg.getAttribute('width')),
      h: Number(svg.getAttribute('height')),
    }))
    expect(natural.h / natural.w).toBeGreaterThan(3)
    await zoomButton(page, '1:1 actual size, readable').tap()
    await zoomButton(page, 'Overview').tap()
    await expect(status(page)).toHaveText(/^Overview, 10%, \d+ of 100 components shown\. Too small to read: tap 1:1\.$/)
    await expect(readout(page)).toHaveText('10%')
    const fitted = await drawing(page)
    expect(fitted.overX).toBeLessThanOrEqual(0)
    expect(fitted.overY).toBeGreaterThan(0)
    expect(fitted.inView).toBeLessThan(100)
    if (process.env.LSD_SHOTS) await page.screenshot({ path: `${process.env.LSD_SHOTS}/121-390-overview.png` })
    // The rest is reached by scrolling down alone.
    await page.locator('.comp-scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expect.poll(async () => (await drawing(page)).top).toBe(fitted.overY)
    const end = await page.locator('.comp-scroll').evaluate((el) => {
      const box = el.getBoundingClientRect()
      const nodes = [...el.querySelectorAll('.component-node')].map((n) => n.getBoundingClientRect())
      return { lastInView: Math.max(...nodes.map((n) => n.bottom)) <= box.bottom + 1, left: el.scrollLeft }
    })
    expect(end).toEqual({ lastInView: true, left: 0 })
    if (process.env.LSD_SHOTS) await page.screenshot({ path: `${process.env.LSD_SHOTS}/121-390-overview-end.png` })
  })

  test('a tall chain is one column that fits the width at 1:1: the rest is down, never sideways (#121)', async ({
    page,
  }) => {
    await openReport(page, { report: chainReport(40) })
    await tab(page, 'Components').tap()
    await expect(pane(page)).toBeVisible()
    await zoomButton(page, '1:1 actual size, readable').tap()
    await expect(readout(page)).toHaveText('100%')
    const actual = await drawing(page)
    expect(actual.overX).toBeLessThanOrEqual(0)
    expect(actual.overY).toBeGreaterThan(0)
    expect(actual.smallest).toBeGreaterThanOrEqual(11)
    await page.locator('.comp-scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expect.poll(async () => (await drawing(page)).top).toBe(actual.overY)
    const end = await drawing(page)
    expect(end.left).toBe(0)
    expect(end.inView).toBeGreaterThan(0)
    if (process.env.LSD_SHOTS) await page.screenshot({ path: `${process.env.LSD_SHOTS}/121-390-chain-1to1.png` })
  })

  test('the example opens with all 14 components, and 1:1 has 11px names (#120)', async ({ page }) => {
    await openReport(page, { report: example })
    await tab(page, 'Components').tap()
    await expect(pane(page)).toBeVisible()
    const fitted = await drawing(page)
    expect(fitted.inView).toBe(14)
    expect(fitted.overX).toBeLessThanOrEqual(0)
    expect(fitted.overY).toBeLessThanOrEqual(0)
    if (process.env.LSD_SHOTS) await page.screenshot({ path: `${process.env.LSD_SHOTS}/105-390-components.png` })
    await zoomButton(page, '1:1 actual size, readable').tap()
    const first = await drawing(page)
    expect(first.smallest).toBeGreaterThanOrEqual(11)
    expect(first.inView).toBeLessThan(14)
    await zoomButton(page, 'Overview').tap()
    expect((await drawing(page)).inView).toBe(14)
    await expect(status(page)).toHaveText(/^Overview, \d+%, whole diagram\. Too small to read: tap 1:1\.$/)
    if (process.env.LSD_SHOTS)
      await page.screenshot({ path: `${process.env.LSD_SHOTS}/105-390-components-overview.png` })
  })
})

test('Shift+0, Shift+1 then Esc from the focused drawing: 1:1, Overview and back, with focus on the drawing all along (#105 UX)', async ({
  page,
}) => {
  await openReport(page, { report: example })
  await showComponents(page)
  const drawing = page.locator('.comp-scroll')
  // Fitted whole it has nothing to scroll, so it is no tab stop (#120); at 1:1 it is.
  await expect(drawing).not.toHaveAttribute('tabindex')
  await zoomButton(page, '1:1 actual size, readable').click()
  await expect(drawing).toHaveAttribute('tabindex', '0')
  await drawing.focus()
  await page.keyboard.press('Shift+Digit1')
  await expect(page.locator('.comp-toolbar [data-zoom="overview"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(drawing).toBeFocused()
  // The keys still reach it: Esc leaves Overview, back to 100%.
  await page.keyboard.press('Escape')
  await expect(page.locator('.comp-toolbar [data-zoom="overview"]')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.comp-toolbar [data-zoom="reset"]')).toHaveText('100%')
  await expect(drawing).toBeFocused()
  await expect(drawing).toHaveAttribute('tabindex', '0')
})
