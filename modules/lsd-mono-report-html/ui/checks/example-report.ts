import { expect, type Page } from '@playwright/test'
import { conformanceReport } from '../src/lib/conformance.test-util'
import { openReport, type OpenOptions } from './open-report'

/**
 * The first four scenarios of the live example report (kitchenSinkSample), as
 * ExampleReportGoldenTest writes them into the shared test reports: 131 (Timed checkout,
 * 14 lanes, 13 pairs, first in the list), 132 (Happy path: card payment, 20 pairs), 133 (Payment
 * declined, 4 lanes, no pair data) and 134 (8 pairs). Shared by the zoom and Metrics checks.
 */
export const example = conformanceReport('example-report')

/**
 * Opens the example report, at [scenarioId] when given. It goes by link, so it works where the
 * scenario list is a menu (a phone). Without one, the first scenario (131) shows.
 */
export async function openExample(page: Page, scenarioId?: string, options: OpenOptions = {}): Promise<void> {
  await openReport(page, { report: example, ...options, path: scenarioId ? `/#scenario=${scenarioId}` : '/' })
  if (scenarioId) await expect(page.locator(`#card-${scenarioId} .seq-svg`)).toBeVisible()
}
