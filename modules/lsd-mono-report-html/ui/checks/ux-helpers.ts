import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
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
    const rgba = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = color
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
    type: 'participant',
  }))
  const events = Array.from({ length: 30 }, (_, i): MessageEvent => ({
    kind: 'message',
    id: `m${i}`,
    from: `p${i % 6}`,
    to: `p${(i + 2) % 6}`,
    label: `call ${i}`,
    type: 'synchronous',
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

/**
 * Wait until the diagram has repainted: Find, zoom and the filter paint once per frame (#104).
 * Two frames, because a refit after a resize paints from the resize observer, which runs after
 * the first frame's animation callbacks.
 */
export function painted(page: Page): Promise<void> {
  return page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

/** Wait for `n` animation frames: what a scroll, focus or resize lands within (#110). */
export function frames(page: Page, n = 2): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
        step(count)
      }),
    n,
  )
}

/**
 * Read `read` once a frame until it gives the same value `frames` reads in a row, and return that
 * value (#110). For "has it settled" and "did nothing change": a scroll still moving, or a late
 * refit, shows as a change and the reading goes on, up to `timeout` ms, when it fails.
 */
export async function expectStable<T>(
  page: Page,
  read: () => Promise<T>,
  { frames: needed = 3, timeout = 5000 }: { frames?: number; timeout?: number } = {},
): Promise<T> {
  const end = Date.now() + timeout
  let last = JSON.stringify(await read())
  let same = 1
  for (;;) {
    await frames(page, 1)
    const value = await read()
    const now = JSON.stringify(value)
    same = now === last ? same + 1 : 1
    last = now
    if (same >= needed) return value
    if (Date.now() > end) throw new Error(`not stable after ${timeout}ms: last ${now}`)
  }
}

/**
 * Wait until every request the page made before this call has reached `route` (#110): fetch
 * `url`, which the route records like any other, and wait for it to arrive. Requests the page
 * makes in order reach the route in order, so once the sentinel is in, nothing earlier is still
 * on its way. The caller's route must answer (abort or fulfil) the sentinel too.
 */
export async function requestsFlushed(page: Page, seen: () => string[], url: string): Promise<void> {
  await page.evaluate((u) => {
    void fetch(u, { mode: 'no-cors' }).catch(() => {})
  }, url)
  await expect.poll(() => seen().includes(url)).toBe(true)
}

/** Zoom readout as a number (85 for "85%") and sideways overflow, for one scenario's diagram, as painted (see painted). */
export function zoomOf(page: Page, scenarioId: string) {
  return page.evaluate(async (id) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
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

/**
 * On a narrow toolbar (a phone, or a card beside the side panel) Find sits behind its magnifier
 * (#123): open it, which focuses the field. Nothing to do on a wide toolbar.
 */
export async function openFind(page: Page, within = page.locator('body')): Promise<void> {
  const toggle = within.locator('[data-find-toggle][aria-expanded="false"]').first()
  if (await toggle.isVisible()) await toggle.click()
}
