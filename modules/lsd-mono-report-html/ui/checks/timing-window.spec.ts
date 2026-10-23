import { expect, test, type Page } from '@playwright/test'
import { openReport } from './open-report'
import { timedReport } from './timed-sample'

// #90: on a long timed scenario the Timing view draws a bounded number of waterfall rows, those
// around the scroll position, and paints the swim-lane bars on a canvas per lane with one button
// per lane. Scrolling brings new rows in; Tab still steps through every bar and row in order;
// rows and bars still open their message.

test.use({ viewport: { width: 1440, height: 900 } })

// 2,000 calls: 2,400 waterfall rows and 2,000 lane bars. Each call carries a body, so its arrow
// opens in the side panel.
const report = timedReport(2000, (step) => ({ path: step.path }))
const scenarioId = report.scenarios[0].id
/** Far fewer than the 2,400 rows, whatever the panel's height. */
const MAX_DRAWN = 150

async function openTiming(page: Page) {
  await openReport(page, { report })
  await page.locator(`#card-${scenarioId} .timing-chip`).first().click()
  await expect(page.locator('#inspector .waterfall[data-waterfall-window]')).toBeVisible()
}

/** The waterfall rows in the DOM: their place in the list, and whether each is on screen in the panel. */
async function drawnRows(page: Page) {
  return page.locator('#inspector').evaluate((panel) => {
    const box = panel.getBoundingClientRect()
    return [...panel.querySelectorAll<HTMLElement>('.waterfall > li')].map((li) => {
      const r = li.getBoundingClientRect()
      return {
        at: Number(li.getAttribute('aria-posinset')),
        of: Number(li.getAttribute('aria-setsize')),
        onScreen: r.bottom > box.top && r.top < Math.min(box.bottom, innerHeight),
      }
    })
  })
}

/** The focused row's place in the list, or the focused lane bar's lane and label. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    const li = el?.closest('.waterfall > li')
    const track = el?.closest('.lane-track')
    const r = el?.getBoundingClientRect()
    const panel = document.querySelector('#inspector')!.getBoundingClientRect()
    return {
      row: li ? Number(li.getAttribute('aria-posinset')) : null,
      lane: track ? Number((track as HTMLElement).dataset.lane) : null,
      label: el?.getAttribute('aria-label') ?? null,
      message: el?.getAttribute('data-show-message') ?? null,
      onScreen: r ? r.bottom > panel.top && r.top < Math.min(panel.bottom, innerHeight) : false,
    }
  })
}

test('a long waterfall draws a bounded number of rows, and scrolling brings new ones in', async ({ page }) => {
  await openTiming(page)
  const first = await drawnRows(page)
  expect(first.length).toBeGreaterThan(5)
  expect(first.length).toBeLessThan(MAX_DRAWN)
  expect(first[0]).toMatchObject({ at: 1, of: 2400 })
  // Lanes: one canvas and one button per lane, not a button per bar.
  const lanes = await page.locator('#inspector .lane-track').count()
  await expect(page.locator('#inspector .lane-bar')).toHaveCount(lanes)
  await expect(page.locator('#inspector .lane-canvas')).toHaveCount(lanes)
  // The panel's DOM stays small.
  expect(await page.locator('#inspector *').count()).toBeLessThan(1000)

  // Halfway down the panel: different rows, still a bounded number, and the ones on screen drawn.
  await page.locator('#inspector').evaluate((panel) => (panel.scrollTop = panel.scrollHeight / 2))
  await expect.poll(async () => (await drawnRows(page))[0].at).toBeGreaterThan(500)
  const middle = await drawnRows(page)
  expect(middle.length).toBeLessThan(MAX_DRAWN)
  expect(middle.filter((r) => r.onScreen).length).toBeGreaterThan(10)
  // Contiguous rows, so nothing on screen is missing.
  for (let i = 1; i < middle.length; i++) expect(middle[i].at).toBe(middle[i - 1].at + 1)

  // The end of the list: its last row is drawn.
  await page.locator('#inspector').evaluate((panel) => (panel.scrollTop = panel.scrollHeight))
  await expect.poll(async () => (await drawnRows(page)).at(-1)?.at).toBe(2400)
})

test('Tab steps through every waterfall row in order, drawing each as it comes', async ({ page }) => {
  await openTiming(page)
  await page.locator('#inspector .waterfall > li[aria-posinset="1"] .wf-row').focus()
  for (let i = 0; i < 80; i++) await page.keyboard.press('Tab')
  expect(await focused(page)).toMatchObject({ row: 81, onScreen: true })
  await page.keyboard.press('Shift+Tab')
  expect(await focused(page)).toMatchObject({ row: 80, onScreen: true })
  // Scrolled away, the focused row stays in the DOM, and Tab goes on from it.
  await page.locator('#inspector').evaluate((panel) => (panel.scrollTop = panel.scrollHeight))
  await expect.poll(async () => (await drawnRows(page)).at(-1)?.at).toBe(2400)
  expect((await focused(page)).row).toBe(80)
  await page.keyboard.press('Tab')
  expect(await focused(page)).toMatchObject({ row: 81, onScreen: true })
})

test('Tab steps through every lane bar, then into the waterfall at its first row', async ({ page }) => {
  await openTiming(page)
  const button = page.locator('#inspector .lane-track[data-lane="0"] .lane-bar')
  const firstMessage = await button.getAttribute('data-show-message')
  await button.focus()
  const messages = [firstMessage]
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab')
    const now = await focused(page)
    expect(now.lane).toBe(0)
    expect(now.label).toBeTruthy()
    messages.push(now.message)
  }
  // Each Tab is another bar, later in time, as each bar was its own button.
  expect(new Set(messages).size).toBe(4)
  const ids = messages.map(Number)
  for (let i = 1; i < ids.length; i++) expect(ids[i]).toBeGreaterThan(ids[i - 1])
  await page.keyboard.press('Shift+Tab')
  expect((await focused(page)).message).toBe(messages[2])

  // From the first waterfall row, Shift+Tab is the last lane's last bar; Tab is the first row again,
  // even with the panel scrolled to the end of the list.
  await page.locator('#inspector .waterfall > li[aria-posinset="1"] .wf-row').focus()
  await page.keyboard.press('Shift+Tab')
  const lanes = await page.locator('#inspector .lane-track').count()
  expect((await focused(page)).lane).toBe(lanes - 1)
  await page.locator('#inspector').evaluate((panel) => (panel.scrollTop = panel.scrollHeight))
  await expect.poll(async () => (await drawnRows(page))[0].at).toBeGreaterThan(1)
  await page.keyboard.press('Tab')
  expect(await focused(page)).toMatchObject({ row: 1, onScreen: true })
})

test('a row halfway down and a bar under the pointer open their message', async ({ page }) => {
  await openTiming(page)
  await page.locator('#inspector').evaluate((panel) => (panel.scrollTop = panel.scrollHeight / 2))
  await expect.poll(async () => (await drawnRows(page))[0].at).toBeGreaterThan(500)
  const row = page
    .locator('#inspector .waterfall > li', { has: page.locator('.wf-row') })
    .nth(20)
    .locator('.wf-row')
  const id = await row.getAttribute('data-show-message')
  await row.click()
  await expect(page.locator(`.seq-scroll button.msg-open[data-message-id="${id}"]`)).toBeVisible()

  // Back to Timing; the pointer over a lane's track brings its button to the bar under it.
  await page.locator(`#card-${scenarioId} .timing-chip`).first().click()
  const track = page.locator('#inspector .lane-track[data-lane="0"]')
  const box = (await track.boundingBox())!
  const bar = track.locator('.lane-bar')
  const before = await bar.getAttribute('data-show-message')
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width * 0.6 + 1, box.y + box.height / 2)
  const target = await bar.getAttribute('data-show-message')
  // Lane 0's bars run the whole report; the button has moved to the one under the pointer.
  expect(target).not.toBe(before)
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-show-message'), {
    x: box.x + box.width * 0.6 + 1,
    y: box.y + box.height / 2,
  })
  expect(hit).toBe(target)
  await page.mouse.click(box.x + box.width * 0.6 + 1, box.y + box.height / 2)
  await expect(page.locator(`.seq-scroll button.msg-open[data-message-id="${target}"]`)).toBeVisible()
})
