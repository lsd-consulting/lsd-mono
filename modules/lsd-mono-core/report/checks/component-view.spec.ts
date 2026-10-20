import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { openReport } from './open-report'
import { seriousViolations } from './ux-helpers'

// #105: the component diagram is the diagram area's other view, behind Sequence | Components tabs.

/** The live example report's first scenario (14 components), as kitchenSinkSample writes it. */
const example = JSON.parse(readFileSync(new URL('./example-components.json', import.meta.url), 'utf8')) as Report

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
  await expect(page.locator('.diagram-view-status')).toHaveText('Component diagram, 14 components, 13 links, zoom 100%')
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
  await expect(page.locator('.diagram-hint')).toHaveText('Pick a link to list its messages')
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
  expect(stops).toEqual([...(metrics ? ['metrics'] : []), ...(overflows ? ['drawing'] : []), 'link'])
})

test('a link opens the side panel with its interactions, Esc gives focus back to it, and Show in sequence goes to the message', async ({
  page,
}) => {
  await openReport(page, { report: example })
  await showComponents(page)
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
  await page.waitForTimeout(100)
  const place = () =>
    seq.evaluate((el) => ({
      top: el.scrollTop,
      left: el.scrollLeft,
      page: window.scrollY,
      zoom: document.querySelector('.seq-toolbar [data-zoom="reset"]')!.textContent,
      stop: el.querySelector('button.msg-open[tabindex="0"]')?.getAttribute('data-message-id'),
      hidden: document.querySelectorAll('.participant-heads .participant-head').length,
    }))
  const before = await place()
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
  await expect(page.locator('.diagram-view-status')).toContainText('zoom 100%')
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
