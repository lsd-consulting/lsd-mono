import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import type { Result } from 'axe-core'
import type { MessageEvent, Participant, Report, Scenario } from '../src/types'
import { uxFixture } from './ux-fixture'

// Shared by the ux-*.spec.ts files.

/**
 * Tags axe-core 4.13 actually ships for WCAG A/AA.
 * wcag22aa covers only the 2.2 rules this axe build implements. There is no
 * wcag22a tag. A green run is not a WCAG 2.2 conformance claim.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

export const THEMES = ['dark', 'light', 'contrast'] as const

export async function openFixture(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript(
    ({ report, themeName }) => {
      window.__LSD_REPORT__ = report
      localStorage.setItem('lsd-report-theme', themeName)
    },
    { report: uxFixture, themeName: theme },
  )
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
  // Context reducedMotion is set in the config, but this Chromium build does not
  // apply it unless emulateMedia runs on the page. The entrance animation otherwise
  // sits near opacity 0 and axe reports false contrast.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
  await expect(page.locator('.msg-label').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

export async function seriousViolations(page: Page): Promise<Result[]> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze()
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

/** The part of the diagram on screen. The stage is as tall as the drawing; only one screen of it paints. */
export async function diagramOnScreen(page: Page) {
  const box = await page.locator('.seq-diagram').boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error('no diagram on screen')
  const y = Math.max(0, box.y)
  return { x: box.x, y, width: box.width, height: Math.min(box.y + box.height, viewport.height) - y }
}

export function formatViolations(violations: Result[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 8)
        .map((n) => `${n.target.join(' ')} :: ${(n.failureSummary ?? '').split('\n')[0]}`)
        .join('\n  ')
      return `${v.id} (${v.impact}) ${v.help}\n  ${nodes}`
    })
    .join('\n')
}

export async function openReport(page: Page, report: Report): Promise<void> {
  await page.addInitScript((value) => {
    window.__LSD_REPORT__ = value
    localStorage.setItem('lsd-report-theme', 'light')
  }, report)
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.seq-svg')).toBeVisible()
}

/** What the browser does around window.print(): beforeprint paints every diagram row. */
export async function startPrint(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
}

export async function endPrint(page: Page): Promise<void> {
  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
}

/** Two scenarios too wide for the panel at 100%: twelve lifelines, a chain of 30 calls. */
export function wideScenario(id: string, title: string): Scenario {
  // Wide enough to fit below 100% at 900-1300px, narrow enough to stay above the 50% Fit floor.
  const participants = Array.from({ length: 6 }, (_, i): Participant => ({
    id: `p${i}`,
    name: `Service ${i}`,
    type: 'PARTICIPANT',
  }))
  const events = Array.from({ length: 30 }, (_, i): MessageEvent => ({
    kind: 'message',
    id: `m${i}`,
    from: `p${i % 6}`,
    to: `p${(i + 2) % 6}`,
    label: `call ${i}`,
    type: 'SYNCHRONOUS',
    data: { n: i },
  }))
  return { ...uxFixture.scenarios[0], id, title, participants, events }
}
export const wideReport: Report = {
  ...uxFixture,
  scenarios: [wideScenario('wide-a', 'Wide A'), wideScenario('wide-b', 'Wide B')],
}

export async function openWide(page: Page, hash = ''): Promise<void> {
  await page.addInitScript((report) => {
    window.__LSD_REPORT__ = report
  }, wideReport)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/${hash}`)
  await expect(page.locator('.seq-svg').first()).toBeVisible()
}

/** Zoom readout as a number (85 for "85%") and sideways overflow, for one scenario's diagram. */
export function zoomOf(page: Page, scenarioId: string) {
  return page.evaluate((id) => {
    const card = document.getElementById(`card-${id}`)!
    const scroll = card.querySelector<HTMLElement>('.seq-scroll')!
    return {
      percent: Number.parseInt(card.querySelector('.zoom-readout')!.textContent ?? '', 10),
      overflowX: scroll.scrollWidth - scroll.clientWidth,
    }
  }, scenarioId)
}

export const threeScenarios: Report = {
  ...uxFixture,
  scenarios: [
    { ...uxFixture.scenarios[0], id: 'browse', title: 'Browse the catalogue', status: 'success' },
    { ...uxFixture.scenarios[0], id: 'pay', title: 'Payment declined', status: 'error' },
    { ...uxFixture.scenarios[0], id: 'stock', title: 'Low stock warning', status: 'warn' },
  ],
}
