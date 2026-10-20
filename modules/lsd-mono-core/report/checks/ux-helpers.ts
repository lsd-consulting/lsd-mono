import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import type { MessageEvent, Participant, Report, Scenario } from '../src/types'
import { openReport } from './open-report'
import { uxFixture } from './ux-fixture'

// Shared by the ux-*.spec.ts files.

/** One axe violation, typed from @axe-core/playwright so axe-core need not be a direct dependency. */
type Result = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]

/**
 * Tags axe-core 4.14 actually ships for WCAG A/AA.
 * wcag22aa covers only the 2.2 rules this axe build implements. There is no
 * wcag22a tag. A green run is not a WCAG 2.2 conformance claim.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

export const THEMES = ['dark', 'light', 'contrast'] as const

/** The small UX fixture in [theme], settled for axe and screenshots. */
export async function openFixture(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await openReport(page, { report: uxFixture, theme, wait: 'labels' })
}

/**
 * sRGB bytes for computed colours, each the [property] of the first element matching its
 * selector, via a 1px canvas, so oklch, color-mix and system colours all resolve.
 */
export async function computedColours(page: Page, picks: [selector: string, property: string][]): Promise<number[][]> {
  return page.evaluate((list) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (colour: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = colour
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data]
    }
    return list.map(([selector, property]) => {
      const el = document.querySelector(selector)
      if (!el) throw new Error(`nothing matches ${selector}`)
      return rgba(getComputedStyle(el).getPropertyValue(property))
    })
  }, picks)
}

/** WCAG contrast ratio of two sRGB colours. */
export function contrastRatio(a: number[], b: number[]): number {
  const lum = ([r, g, bl]: number[]) => {
    const c = [r, g, bl].map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
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
function wideScenario(id: string, title: string): Scenario {
  // Wide enough to fit below 100% at 900-1300px, narrow enough to stay above the default view's 95% floor.
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
const wideReport: Report = {
  ...uxFixture,
  scenarios: [wideScenario('wide-a', 'Wide A'), wideScenario('wide-b', 'Wide B')],
}

export async function openWide(page: Page, hash = ''): Promise<void> {
  await openReport(page, { report: wideReport, path: `/${hash}` })
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

/** The shown scenario's warning with a reason: what the reading-order checks look at. */
export const pendingReport: Report = {
  ...uxFixture,
  scenarios: [
    {
      ...uxFixture.scenarios[0],
      status: 'warn',
      error: { headline: 'Pending', message: 'refunds come later\nStep: When the refund is not written yet' },
    },
  ],
}

/**
 * The top edge of each part of the shown scenario, in reading order: its description card, the
 * error panel inside it, its key facts card, and its diagram panel.
 */
export async function scenarioPartTops(
  page: Page,
): Promise<{ description: number; error: number; facts: number; diagram: number }> {
  return page
    .locator('.scenario-card:visible')
    .first()
    .evaluate((card) => {
      const top = (selector: string) => card.querySelector(selector)!.getBoundingClientRect().top
      return {
        description: top('.scenario-body > .cards > .card:first-child'),
        error: top('.error-panel'),
        facts: top('.scenario-body > .cards > .card:nth-child(2)'),
        diagram: top('.scenario-body > .diagram-panel'),
      }
    })
}
