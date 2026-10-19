import { expect, test } from '@playwright/test'
import type { MessageEvent, MessageType, Report } from '../src/types'
import { THEMES, contrastRatio } from './ux-helpers'

// axe does not score SVG strokes, so compute them: every kind of arrow, in every theme, with the
// pale colours producers send (the sample palette) and with none (replies take the default).

const PALETTE = ['#38bdf8', '#34d399', '#a78bfa', '#fbbf24', '#94a3b8', '#fb7185', '#f87171', '#16a34a', '#fde047']
const TYPES: MessageType[] = [
  'SYNCHRONOUS',
  'SYNCHRONOUS_RESPONSE',
  'ASYNCHRONOUS',
  'LOST',
  'BI_DIRECTIONAL',
  'SHORT_INBOUND',
  'SHORT_OUTBOUND',
]

const report: Report = {
  title: 'Strokes',
  generatedAt: '2026-01-15T12:00:00+00:00',
  generator: 'ux-strokes',
  scenarios: [
    {
      id: 's',
      title: 'Strokes',
      status: 'success',
      description: 'Every arrow kind.',
      facts: [],
      metrics: [],
      participants: [
        { id: 'a', name: 'A', type: 'ACTOR' },
        ...PALETTE.map((colour, i) => ({ id: `p${i}`, name: `P${i}`, type: 'PARTICIPANT' as const, colour })),
        { id: 'db', name: 'Db', type: 'DATABASE' },
        { id: 'q', name: 'Q', type: 'QUEUE' },
      ],
      events: TYPES.flatMap((type) =>
        [undefined, ...PALETTE].map((colour, i): MessageEvent => ({
          kind: 'message',
          id: `${type}-${i}`,
          from: type === 'SHORT_INBOUND' ? '' : 'a',
          to: type === 'SHORT_OUTBOUND' ? '' : 'p0',
          label: 'x',
          type,
          colour,
          data: { n: 1 },
        })),
      ),
    },
  ],
}

for (const theme of THEMES) {
  test(`arrows, tips, participant outlines and the {} marker keep their contrast in the ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ r, t }) => {
        window.__LSD_REPORT__ = r
        localStorage.setItem('lsd-report-theme', t)
      },
      { r: report, t: theme },
    )
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1400, height: 4000 })
    await page.goto('/')
    await expect(page.locator('.seq-svg')).toBeVisible()
    const measured = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const rgba = (colour: string) => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = colour
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data]
      }
      const surface = rgba(getComputedStyle(document.querySelector('.seq-scroll')!).backgroundColor)
      const pick = (selector: string, property: 'stroke' | 'fill' | 'color') =>
        [...document.querySelectorAll(selector)].map((el) => rgba(getComputedStyle(el)[property]))
      return {
        surface,
        arrows: pick('.msg-path', 'stroke'),
        strokeTips: pick('.arrow-ink-stroke', 'stroke'),
        filledTips: pick('.arrow-ink-fill', 'fill'),
        shapes: pick('.participant-shape, .participant-actor, .participant-mark', 'stroke'),
        marker: pick('.msg-payload', 'fill'),
        legend: pick('.payload-legend-key', 'color'),
      }
    })
    const worst = (colours: number[][]) => Math.min(...colours.map((c) => contrastRatio(c, measured.surface)))
    expect(measured.arrows.length).toBeGreaterThan(50)
    expect(worst(measured.arrows), 'arrow strokes').toBeGreaterThanOrEqual(3)
    expect(worst(measured.strokeTips), 'open and lost tips').toBeGreaterThanOrEqual(3)
    expect(worst(measured.filledTips), 'filled tips').toBeGreaterThanOrEqual(3)
    expect(worst(measured.shapes), 'participant outlines').toBeGreaterThanOrEqual(3)
    expect(worst(measured.marker), '{} marker').toBeGreaterThanOrEqual(4.5)
    expect(worst(measured.legend), 'legend key').toBeGreaterThanOrEqual(4.5)
  })
}
