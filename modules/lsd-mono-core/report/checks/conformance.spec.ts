import { expect, test, type Page } from '@playwright/test'
import { conformanceReport, largeReport } from '../src/lib/conformance.test-util'
import type { Report } from '../src/types'
import { openReport } from './open-report'
import { formatViolations, seriousViolations } from './ux-helpers'

// A smoke test on key shared test reports (modules/lsd-mono-report-schema/conformance) in a real
// browser: the page is never blank, logs no console error or page error, and has no serious axe
// violation. Vitest (src/conformance.test.ts) boots the page on every one of them.

const REPORTS: [string, () => Report][] = [
  ['minimal', () => conformanceReport('minimal')],
  ['large (100 participants, 400 messages)', () => largeReport()],
  ['future minor version, with unknown fields', () => conformanceReport('future-minor')],
  ['Unicode and right to left', () => conformanceReport('unicode-rtl')],
]

function watchProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`page: ${error.message}`))
  return problems
}

for (const [name, load] of REPORTS) {
  test(`shared report: ${name} renders, with no console error`, async ({ page }) => {
    const report = load()
    const problems = watchProblems(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await openReport(page, { report, wait: 'none' })

    await expect(page.locator('#scenario-title')).toHaveText(report.scenarios[0].title)
    expect((await page.locator('#main').innerText()).trim().length).toBeGreaterThan(0)
    if (report.scenarios[0].participants.length > 0) await expect(page.locator('.seq-svg').first()).toBeVisible()
    await expect(page.locator('.schema-notice')).toHaveCount(report.schemaVersion === '0.2.0' ? 1 : 0)
    const violations = await seriousViolations(page)
    expect(violations, formatViolations(violations)).toEqual([])
    expect(problems).toEqual([])
  })
}

test('shared report: next major version shows the upgrade page, with no console error', async ({ page }) => {
  const problems = watchProblems(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReport(page, { report: conformanceReport('next-major'), wait: 'none' })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Upgrade lsd-mono to open this report')
  await expect(page.locator('.schema-upgrade')).toContainText('report format 1.0.0')
  await expect(page.locator('.scenario-card')).toHaveCount(0)
  const violations = await seriousViolations(page)
  expect(violations, formatViolations(violations)).toEqual([])
  expect(problems).toEqual([])
})
