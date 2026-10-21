import { expect, test, type Locator, type Page } from '@playwright/test'
import { uxFixture } from './ux-fixture'
import {
  THEMES,
  openFixture,
  seriousViolations,
  formatViolations,
  startPrint,
  endPrint,
  openWide,
  zoomOf,
} from './ux-helpers'
import { openReport } from './open-report'

// Participant filter (#8): Hide (×) and More (⋯) on each header, a chip while anything is
// hidden, and a menu with "Hide all but this one".

/** The opacity of [id]'s header buttons, or null while the one set of them is on another header (#62). */
const actionsOpacity = (page: Page, id: string) =>
  page.evaluate((head) => {
    const bar = document.querySelector(`[data-participant-head="${head}"] .participant-head-actions`)
    return bar ? getComputedStyle(bar).opacity : null
  }, id)

/** The sequence toolbar's last shown control, the tab stop just before the header row. */
const lastToolbarControl = (page: Page) =>
  page.locator('.diagram-pane[data-pane="sequence"] .seq-toolbar button:not([disabled]):visible').last()

/**
 * Hover a header with it a third of the way down the window, so the Hide and More bar it opens
 * just under it (#92) is on screen. A click that first had to scroll the page to the bar would
 * move the header out from under the pointer, and the bar closes with the hover.
 */
async function hoverHead(head: Locator): Promise<void> {
  await head.evaluate(async (el) => {
    scrollBy(0, el.getBoundingClientRect().top - innerHeight / 3)
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  })
  await head.hover()
}

const headerNames = (page: Page) =>
  page
    .locator('.seq-header-svg .participant-box')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-participant')))

test('a pointer passing over another header does not move keyboard focus: Enter hides the focused one (#62)', async ({
  page,
}) => {
  await openFixture(page, 'dark')
  await lastToolbarControl(page).focus()
  await page.keyboard.press('Tab')
  const hideClient = page.getByRole('button', { name: 'Hide Client' })
  await expect(hideClient).toBeFocused()
  await page.locator('[data-participant-head="db"]').hover()
  await expect(hideClient).toBeFocused()
  expect(await actionsOpacity(page, 'db')).toBeNull()
  await page.keyboard.press('Enter')
  expect(await headerNames(page)).toEqual(['api', 'db', 'bus'])
  await expect(page.locator('.participant-filter-status')).toHaveText('Client hidden. 1 hidden.')
})

test('a click on a header name, then Tab in from the page: hover still leaves keyboard focus alone (#62)', async ({
  page,
}) => {
  await openFixture(page, 'dark')
  // A click on Client's name, low in its header, under where the buttons appear: focus stays out.
  const client = page.locator('[data-participant-head="client"]')
  const box = (await client.boundingBox())!
  await client.click({ position: { x: box.width / 2, y: box.height - 6 } })
  await expect(page.locator('.participant-heads button:focus')).toHaveCount(0)
  await lastToolbarControl(page).focus()
  await page.keyboard.press('Tab')
  const hideClient = page.getByRole('button', { name: 'Hide Client' })
  await expect(hideClient).toBeFocused()
  await page.locator('[data-participant-head="db"]').hover()
  await expect(hideClient).toBeFocused()
  await page.keyboard.press('Enter')
  expect(await headerNames(page)).toEqual(['api', 'db', 'bus'])
  await expect(page.locator('.participant-filter-status')).toHaveText('Client hidden. 1 hidden.')
})

test('a header × appears on hover and hides that participant; the chip lists it and passes axe', async ({ page }) => {
  await openFixture(page, 'dark')
  await expect(page.locator('[data-participant-toggle]')).toHaveCount(0)
  await expect(page.locator('.hidden-chip')).toHaveCount(0)
  // The one set of buttons starts on the first header, there but hidden.
  expect(await actionsOpacity(page, 'client')).toBe('0')
  expect(await actionsOpacity(page, 'db')).toBeNull()

  await hoverHead(page.locator('[data-participant-head="db"]'))
  expect(await actionsOpacity(page, 'db')).toBe('1')
  const hovered = await seriousViolations(page)
  expect(hovered, formatViolations(hovered)).toEqual([])

  await page.getByRole('button', { name: 'Hide Database' }).click()
  expect(await headerNames(page)).toEqual(['client', 'api', 'bus'])
  // Messages to or from the hidden column are left out, as before.
  await expect(page.locator('.seq-window .msg-label').first()).toBeVisible()
  await expect(page.locator('.seq-window .msg-label', { hasText: 'insert' })).toHaveCount(0)
  const chip = page.getByRole('button', { name: '1 hidden participant' })
  await expect(chip).toHaveText('1 hidden')
  await expect(page.locator('.participant-filter-status')).toHaveText('Database hidden. 1 hidden.')
  // Find still counts what the hidden column hides.
  await page.locator('[data-diagram-find]').fill('insert')
  await expect(page.locator('.diagram-find-count')).toContainText('on a hidden column')
  await page.locator('[data-diagram-find]').fill('')

  for (const theme of THEMES) {
    if (theme !== 'dark') {
      await openFixture(page, theme)
      await hoverHead(page.locator('[data-participant-head="db"]'))
      await page.getByRole('button', { name: 'Hide Database' }).click()
    }
    await page.getByRole('button', { name: '1 hidden participant' }).click()
    const dialog = page.getByRole('dialog', { name: 'Hidden participants' })
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show Database' })).toBeFocused()
    const open = await seriousViolations(page)
    expect(open, `${theme}\n${formatViolations(open)}`).toEqual([])
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: '1 hidden participant' })).toBeFocused()
  }

  await page.getByRole('button', { name: '1 hidden participant' }).click()
  await page.getByRole('button', { name: 'Show Database' }).click()
  await expect(page.locator('.hidden-chip')).toHaveCount(0)
  expect(await headerNames(page)).toEqual(['client', 'api', 'db', 'bus'])
  await expect(page.getByRole('button', { name: 'Hide Database' })).toBeFocused()
})

test('Escape closes the hidden list without closing the side panel', async ({ page }) => {
  await openFixture(page, 'dark')
  await page.locator('button.msg-open[data-message-id="m0"]').click()
  await expect(page.locator('#inspector')).toBeVisible()
  await hoverHead(page.locator('[data-participant-head="bus"]'))
  await page.getByRole('button', { name: 'Hide Queue' }).click()
  await page.getByRole('button', { name: '1 hidden participant' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Hidden participants' })).toBeHidden()
  await expect(page.locator('#inspector')).toBeVisible()
})

test('right-click, or Shift+F10 from the keyboard, offers Hide all but this one; axe stays clean', async ({ page }) => {
  for (const theme of THEMES) {
    await openFixture(page, theme)
    await page.locator('[data-participant-head="api"]').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Actions for Api' })
    await expect(menu).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Hide all but Api' })).toBeFocused()
    await expect(page.getByRole('menuitem', { name: 'Show all' })).toHaveAttribute('aria-disabled', 'true')
    const violations = await seriousViolations(page)
    expect(violations, `${theme}\n${formatViolations(violations)}`).toEqual([])
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  }

  // Keyboard: one tab stop for the header row, shown on focus; arrows move along it.
  // (A fresh page: the tab stop otherwise stays on the header the menu was opened from.)
  await openFixture(page, 'dark')
  await lastToolbarControl(page).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Hide Client' })).toBeFocused()
  expect(await actionsOpacity(page, 'client')).toBe('1')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Hide Api' })).toBeFocused()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Hide all but Api' })).toBeFocused()
  await page.keyboard.press('Enter')
  expect(await headerNames(page)).toEqual(['api'])
  await expect(page.locator('.hidden-chip')).toHaveText('3 hidden')
  await expect(page.getByRole('button', { name: 'Hide Api' })).toBeFocused()

  // The menu's Show all, from the More button.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'More actions for Api' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Show all' }).click()
  expect(await headerNames(page)).toEqual(['client', 'api', 'db', 'bus'])
  await expect(page.locator('.hidden-chip')).toHaveCount(0)
})

test('hiding refits a diagram the user has not zoomed, and keeps a zoom they chose', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await openWide(page)
  const card = page.locator('#card-wide-a')
  const before = (await zoomOf(page, 'wide-a')).percent
  expect(before).toBeLessThan(100)
  for (const id of ['p0', 'p1', 'p2', 'p3']) {
    await hoverHead(card.locator(`[data-participant-head="${id}"]`))
    await card.getByRole('button', { name: `Hide Service ${id.slice(1)}`, exact: true }).click()
  }
  await expect.poll(async () => (await zoomOf(page, 'wide-a')).percent).toBeGreaterThan(before)
  expect((await zoomOf(page, 'wide-a')).overflowX).toBeLessThanOrEqual(0)

  await card.getByRole('button', { name: 'Zoom in' }).click()
  const chosen = (await zoomOf(page, 'wide-a')).percent
  await hoverHead(card.locator('[data-participant-head="p4"]'))
  await card.getByRole('button', { name: 'Hide Service 4', exact: true }).click()
  await page.waitForTimeout(200)
  expect((await zoomOf(page, 'wide-a')).percent).toBe(chosen)
  // Per scenario: the other diagram keeps all its participants.
  await page.locator('#scenario-nav [data-nav="wide-b"]').click()
  await expect(page.locator('#card-wide-b .seq-header-svg .participant-box')).toHaveCount(6)
  await expect(page.locator('#card-wide-b .hidden-chip')).toHaveCount(0)
  // Back on the first scenario, its hidden participants and its zoom are as they were.
  await page.locator('#scenario-nav [data-nav="wide-a"]').click()
  await expect(page.locator('#card-wide-a .seq-header-svg .participant-box')).toHaveCount(1)
  await expect(page.locator('#card-wide-a .hidden-chip')).toHaveText('5 hidden')
  expect((await zoomOf(page, 'wide-a')).percent).toBe(chosen)
})

test('print keeps hidden participants hidden and leaves out the header buttons and the chip', async ({ page }) => {
  await openReport(page, { report: uxFixture, theme: 'light' })
  await hoverHead(page.locator('[data-participant-head="db"]'))
  await page.getByRole('button', { name: 'Hide Database' }).click()
  await page.locator('[data-participant-head="bus"]').click({ button: 'right' })
  await startPrint(page)
  await expect(page.locator('.hidden-chip')).toBeHidden()
  await expect(page.locator('.participant-heads')).toBeHidden()
  await expect(page.locator('.participant-menu')).toBeHidden()
  expect(await headerNames(page)).toEqual(['client', 'api', 'bus'])
  // Only the five client → api calls do not need the hidden Database column.
  await expect(page.locator('.seq-window .msg-label')).toHaveCount(5)
  await endPrint(page)
})

/**
 * Scroll the page so the participant headers end 20 px above the bottom of the window: no room
 * there for a header's bar below it. Returns the page's scroll, which opening the bar keeps.
 */
async function headerNearBottom(page: Page): Promise<number> {
  const head = page.locator('[data-participant-head]').first()
  await head.evaluate(async (el) => {
    scrollBy(0, el.getBoundingClientRect().bottom - (innerHeight - 20))
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  })
  const room = await head.evaluate((el) => innerHeight - el.getBoundingClientRect().bottom)
  expect(room, 'the header sits near the bottom of the window').toBeLessThan(30)
  expect(room).toBeGreaterThan(0)
  return page.evaluate(() => scrollY)
}

/** [id]'s bar in window px, whether it opened above its header, and whether it is on top there. */
const barPlace = (page: Page, id: string) =>
  page.evaluate((head) => {
    const bar = document.querySelector(`[data-participant-head="${head}"] .participant-head-actions`)!
    const box = bar.getBoundingClientRect()
    const header = document.querySelector(`[data-participant-head="${head}"]`)!.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + 12, box.top + box.height / 2)
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      headerTop: header.top,
      width: innerWidth,
      height: innerHeight,
      scrollY,
      onTop: !!hit?.closest('.participant-head-actions'),
    }
  }, id)

const onScreen = (place: Awaited<ReturnType<typeof barPlace>>) => {
  expect(place.top).toBeGreaterThanOrEqual(0)
  expect(place.left).toBeGreaterThanOrEqual(0)
  expect(place.bottom).toBeLessThanOrEqual(place.height)
  expect(place.right).toBeLessThanOrEqual(place.width)
  expect(place.bottom, 'the bar opens above its header').toBeLessThanOrEqual(place.headerTop)
  expect(place.onTop, 'the bar is on top and takes the pointer').toBe(true)
}

test('with no room below it in the window, a header’s bar opens above it, on screen, and still works (#92)', async ({
  page,
}) => {
  await openFixture(page, 'dark')
  const scrolled = await headerNearBottom(page)
  // The pointer: the bar opens above without the page scrolling, and its Hide works from there.
  await page.locator('[data-participant-head="db"]').hover()
  expect(await actionsOpacity(page, 'db')).toBe('1')
  const hovered = await barPlace(page, 'db')
  onScreen(hovered)
  expect(hovered.scrollY, 'without scrolling the page').toBe(scrolled)
  await page.getByRole('button', { name: 'Hide Database' }).click()
  expect(await headerNames(page)).toEqual(['client', 'api', 'bus'])

  // The keyboard: Tab into the row opens it above too.
  // (A fresh page: the tab stop otherwise stays on the header next to the hidden one.)
  await openFixture(page, 'dark')
  await headerNearBottom(page)
  await lastToolbarControl(page).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Hide Client' })).toBeFocused()
  onScreen(await barPlace(page, 'client'))
  await page.keyboard.press('ArrowRight')
  const more = page.getByRole('button', { name: 'More actions for Client' })
  await expect(more).toBeFocused()
  onScreen(await barPlace(page, 'client'))
  // Its menu opens from there, and Escape closes the menu first, back on More, the bar still up.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Hide all but Client' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(more).toBeFocused()
  onScreen(await barPlace(page, 'client'))
})

test('on a phone, with no room below it, a tapped header’s bar opens above it, on screen (#92)', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 664 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  })
  try {
    const page = await context.newPage()
    await openFixture(page, 'dark')
    const scrolled = await headerNearBottom(page)
    await page.locator('[data-participant-head="api"]').tap()
    expect(await actionsOpacity(page, 'api')).toBe('1')
    const tapped = await barPlace(page, 'api')
    onScreen(tapped)
    expect(tapped.scrollY, 'without scrolling the page').toBe(scrolled)
    await page.getByRole('button', { name: 'Hide Api' }).tap()
    expect(await headerNames(page)).toEqual(['client', 'db', 'bus'])
  } finally {
    await context.close()
  }
})

test('on a phone a tap shows a header’s buttons below it, a long press opens the menu, and the chip list fits', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 664 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  })
  try {
    const page = await context.newPage()
    await openFixture(page, 'dark')
    await page.locator('.seq-diagram').scrollIntoViewIfNeeded()
    expect(await actionsOpacity(page, 'client')).toBe('0')
    expect(await actionsOpacity(page, 'api')).toBeNull()

    // A tap shows the buttons just under the header (#92).
    await page.locator('[data-participant-head="api"]').tap()
    expect(await actionsOpacity(page, 'api')).toBe('1')
    const placed = await page.evaluate(() => {
      const header = document.querySelector('.seq-sticky-header')!.getBoundingClientRect()
      const bar = document.querySelector('[data-participant-head="api"] .participant-head-actions')!
      const box = bar.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + 12, box.top + 12)
      return {
        headerTop: header.top,
        headerBottom: header.bottom,
        top: box.top,
        onTop: !!hit?.closest('.participant-head-actions'),
      }
    })
    expect(placed.top).toBeGreaterThanOrEqual(placed.headerTop)
    expect(placed.top).toBeLessThan(placed.headerBottom + 40)
    expect(placed.onTop, 'the revealed buttons are on top and tappable').toBe(true)
    await page.getByRole('button', { name: 'Hide Api' }).tap()
    expect(await headerNames(page)).toEqual(['client', 'db', 'bus'])

    await page.locator('.hidden-chip').tap()
    const dialog = page.getByRole('dialog', { name: 'Hidden participants' })
    await expect(dialog).toBeVisible()
    const box = (await dialog.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    const violations = await seriousViolations(page)
    expect(violations, formatViolations(violations)).toEqual([])
    await page.getByRole('button', { name: 'Show Api' }).tap()
    await expect(page.locator('.hidden-chip')).toHaveCount(0)

    // Long press (iOS Safari fires no contextmenu, so the report times the press itself).
    // Fit stops at 95%, so on a phone the lane may lie beyond the right edge: scroll to it first.
    await page.locator('[data-participant-head="db"]').scrollIntoViewIfNeeded()
    const head = (await page.locator('[data-participant-head="db"]').boundingBox())!
    const cdp = await context.newCDPSession(page)
    const point = { x: head.x + head.width / 2, y: head.y + head.height / 2 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await page.waitForTimeout(800)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const menu = page.getByRole('menu', { name: 'Actions for Database' })
    await expect(menu).toBeVisible()
    const menuBox = (await menu.boundingBox())!
    expect(menuBox.x).toBeGreaterThanOrEqual(0)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390)
    await page.getByRole('menuitem', { name: 'Hide all but Database' }).tap()
    expect(await headerNames(page)).toEqual(['db'])
    await expect(page.locator('.hidden-chip')).toHaveText('3 hidden')
  } finally {
    await context.close()
  }
})
