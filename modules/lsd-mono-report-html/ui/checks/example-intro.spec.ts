import { expect, test, type Page } from '@playwright/test'
import { example } from './example-report'
import { openReport } from './open-report'

// #161: the example site's introduction. The checks run on localhost, so they set the flag the
// Pages site's location would.
async function openIntro(page: Page, viewport: { width: number; height: number }, storage = {}) {
  await openReport(page, { report: example, viewport, storage, navigate: false })
  await page.addInitScript(() => (window.__LSD_EXAMPLE__ = true))
  await page.goto('/')
  await expect(page.locator('.seq-svg').first()).toBeVisible()
}

test('a generated report has no introduction', async ({ page }) => {
  await openReport(page, { report: example, viewport: { width: 1280, height: 800 } })
  await expect(page.locator('#example-intro')).toHaveCount(0)
})

test('the introduction is a labelled region that leaves the diagram where it was at 1280×800', async ({ page }) => {
  await openIntro(page, { width: 1280, height: 800 })
  const intro = page.getByRole('region', { name: 'An example LSD report' })
  await expect(intro).toBeVisible()
  await expect(intro.getByRole('link', { name: 'Spring Boot 4 demo' })).toHaveAttribute(
    'href',
    'https://lsd-consulting.github.io/lsd-mono/spring-boot-4/',
  )
  // It sits in the sidebar, so the scenario and its diagram start where they do without it.
  const diagram = (await page.locator('.seq-scroll').first().boundingBox())!
  expect(diagram.y).toBeLessThan(800)
  const card = (await page.locator('.scenario-card').boundingBox())!
  const head = (await page.locator('.topbar').boundingBox())!
  expect(card.y - (head.y + head.height)).toBeLessThan(120)
})

test('dismissing it is remembered', async ({ page }) => {
  await openIntro(page, { width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Dismiss the introduction' }).click()
  await expect(page.locator('#example-intro')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.seq-svg').first()).toBeVisible()
  await expect(page.locator('#example-intro')).toHaveCount(0)
})

test('it reflows at 320 px', async ({ page }) => {
  await openIntro(page, { width: 320, height: 640 })
  await expect(page.locator('#example-intro')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})
