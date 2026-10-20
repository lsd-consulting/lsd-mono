import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import type { Report } from '../src/types'
import { openReport, type OpenOptions } from './open-report'

/**
 * Scenarios from the live example report, as kitchenSinkSample writes them: 144 (Timed checkout,
 * 14 lanes, 13 pairs, first in the list), 145 (Happy path: card payment, 20 pairs), 146 (Payment
 * declined, 4 lanes, no pair data) and 147 (8 pairs). Shared by the zoom and Metrics checks.
 */
export const example = JSON.parse(readFileSync(new URL('./example-report.json', import.meta.url), 'utf8')) as Report

/**
 * Opens the example report, at [scenarioId] when given. It goes by link, so it works where the
 * scenario list is a menu (a phone). Without one, the first scenario (144) shows.
 */
export async function openExample(page: Page, scenarioId?: string, options: OpenOptions = {}): Promise<void> {
  await openReport(page, { report: example, ...options, path: scenarioId ? `/#scenario=${scenarioId}` : '/' })
  if (scenarioId) await expect(page.locator(`#card-${scenarioId} .seq-svg`)).toBeVisible()
}
