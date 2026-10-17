import { expect, test, type Page } from '@playwright/test'
import { THEMES, seriousViolations, formatViolations, startPrint, endPrint, threeScenarios } from './ux-helpers'

// One scenario at a time, chosen from the sidebar (#39).

async function openThree(page: Page, hash = ''): Promise<void> {
  await page.addInitScript((report) => {
    window.__LSD_REPORT__ = report
  }, threeScenarios)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/${hash}`)
  await expect(page.locator('.seq-svg')).toBeVisible()
}

const shown = (page: Page) =>
  page.locator('#main .scenario-card').evaluateAll((cards) => cards.map((card) => card.id.slice('card-'.length)))
const current = (page: Page) => page.locator('#scenario-nav [aria-current="true"]')

test('the main column shows only the selected scenario: the first in the list by default, then the one chosen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openThree(page)
  // The first in the list, even though a later one failed.
  expect(await shown(page)).toEqual(['browse'])
  await expect(current(page)).toHaveAttribute('data-nav', 'browse')
  await expect(page.locator('#scenario-nav [aria-current]')).toHaveCount(1)
  // A plain heading now: nothing to open or close.
  await expect(page.locator('.scenario-head[role="button"]')).toHaveCount(0)
  await expect(page.locator('#main .seq-diagram')).toHaveCount(1)

  await page.locator('#scenario-nav [data-nav="stock"]').click()
  expect(await shown(page)).toEqual(['stock'])
  await expect(current(page)).toHaveAttribute('data-nav', 'stock')
  await expect(page.locator('#scenario-nav [data-nav="stock"]')).toBeFocused()
  await expect(page).toHaveURL(/#scenario=stock$/)

  // A reload or a shared link shows the same scenario.
  await page.reload()
  await expect(page.locator('.seq-svg')).toBeVisible()
  expect(await shown(page)).toEqual(['stock'])

  // Print has only the selected scenario.
  await startPrint(page)
  await expect(page.locator('.scenario-card')).toHaveCount(1)
  await expect(page.locator('.scenario-card h2')).toHaveText('Low stock warning')
  await endPrint(page)

  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
})

test('a message link selects its scenario and opens the message; closing the panel keeps the scenario in the URL', async ({
  page,
}) => {
  await openThree(page, '#msg=browse/m3')
  expect(await shown(page)).toEqual(['browse'])
  await expect(page.locator('#inspector-title')).toHaveText('charge 3')
  await page.keyboard.press('Escape')
  await expect(page.locator('#inspector')).toBeHidden()
  await expect(page).toHaveURL(/#scenario=browse$/)
  // Editing the address (or Back) follows the hash.
  await page.evaluate(() => {
    window.location.hash = '#scenario=pay'
  })
  await expect.poll(() => shown(page)).toEqual(['pay'])
})

test('search and status filters narrow the list, move the selection on, and show an empty state', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openThree(page, '#scenario=pay')
  // Error off: Payment declined leaves the list, and the next match shows.
  await page.locator('[data-filter="error"]').click()
  await expect(page.locator('#scenario-nav [data-nav]')).toHaveCount(2)
  expect(await shown(page)).toEqual(['stock'])
  await expect(current(page)).toHaveAttribute('data-nav', 'stock')

  // Search keeps the selection while it still matches, and does not redraw it.
  await page.locator('.seq-scroll').evaluate((el) => el.setAttribute('data-kept', 'yes'))
  await page.locator('#search').fill('stock')
  await expect(page.locator('.seq-scroll')).toHaveAttribute('data-kept', 'yes')

  await page.locator('#search').fill('no scenario has this')
  await expect(page.locator('#scenario-nav [data-nav]')).toHaveCount(0)
  await expect(page.locator('#main .scenario-card')).toHaveCount(0)
  const empty = page.locator('#main .empty')
  await expect(empty).toContainText('No scenarios match your search and status filters.')
  for (const theme of THEMES) {
    await page.evaluate((name) => document.documentElement.setAttribute('data-theme', name), theme)
    const violations = await seriousViolations(page)
    expect(violations, `${theme}\n${formatViolations(violations)}`).toEqual([])
  }

  await empty.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.locator('#search')).toHaveValue('')
  await expect(page.locator('[data-filter="error"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#scenario-nav [data-nav]')).toHaveCount(3)
  expect(await shown(page)).toEqual(['stock'])
  await expect(page.locator('#scenario-title')).toBeFocused()
})

test('j/k and the arrow keys move the selection, Enter goes into the diagram, focus follows sensibly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await openThree(page)
  // On the list, arrows move the selection and focus with it.
  await page.locator('#scenario-nav [data-nav="browse"]').focus()
  await page.keyboard.press('ArrowDown')
  await expect(current(page)).toHaveAttribute('data-nav', 'pay')
  await expect(page.locator('#scenario-nav [data-nav="pay"]')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  expect(await shown(page)).toEqual(['stock'])
  await page.keyboard.press('ArrowUp')
  expect(await shown(page)).toEqual(['pay'])

  // From inside the scenario, j replaces it and focus lands on the new heading.
  await page.getByRole('button', { name: 'Zoom in' }).focus()
  await page.keyboard.press('j')
  expect(await shown(page)).toEqual(['stock'])
  await expect(page.locator('#scenario-title')).toBeFocused()
  await page.keyboard.press('k')
  expect(await shown(page)).toEqual(['pay'])

  // Enter (not on a button) goes into the diagram, on its first message.
  await page.keyboard.press('Enter')
  await expect(page.locator('button.msg-open[data-message-id="m0"]')).toBeFocused()

  // Arrows in the diagram toolbar do not switch scenarios.
  await page.getByRole('button', { name: 'Zoom in' }).focus()
  await page.keyboard.press('ArrowDown')
  expect(await shown(page)).toEqual(['pay'])

  await expect(page.locator('#help')).toContainText('next/prev scenario')
  await expect(page.locator('#help')).toContainText('go to its diagram')
})

test('the collapsed rail is enough to move between scenarios', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.addInitScript(() => localStorage.setItem('lsd-report-sidebar', 'collapsed'))
  await openThree(page)
  await expect(page.locator('#btn-sidebar')).toHaveAttribute('aria-expanded', 'false')
  expect(await shown(page)).toEqual(['browse'])
  const rail = page.locator('#scenario-nav [data-nav="pay"]')
  await expect(rail).toHaveAccessibleName(/Payment declined/)
  await expect(rail.locator('.nav-icon')).toHaveText('2')
  await rail.click()
  expect(await shown(page)).toEqual(['pay'])
  await expect(rail).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('ArrowDown')
  expect(await shown(page)).toEqual(['stock'])
  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
})

test('on a phone the list sits above the scenario, and choosing one scrolls it into view below the bar', async ({
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
    await openThree(page)
    await page.locator('#scenario-nav [data-nav="browse"]').tap()
    expect(await shown(page)).toEqual(['browse'])
    const placed = await page.evaluate(() => ({
      bar: document.querySelector('.topbar')!.getBoundingClientRect().bottom,
      card: document.querySelector('.scenario-card')!.getBoundingClientRect().top,
    }))
    expect(placed.card).toBeGreaterThanOrEqual(Math.floor(placed.bar))
    expect(placed.card).toBeLessThan(placed.bar + 40)
    const violations = await seriousViolations(page)
    expect(violations, formatViolations(violations)).toEqual([])
  } finally {
    await context.close()
  }
})
