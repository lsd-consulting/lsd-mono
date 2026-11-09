import { expect, test, type Page } from '@playwright/test'
import { reportBase, untimed } from '../src/lib/report-fixture.test-util'
import type { Report } from '../src/types'
import { openReport } from './open-report'
import { computedColours, contrastRatio } from './ux-helpers'

/** A report with auto-highlighted Gherkin keywords and a pass-through <mark> in the description. */
const report: Report = {
  ...reportBase(),
  title: 'Keyword contrast',
  generatedAt: '2026-01-15T12:00:00+00:00',
  generator: { name: 'keyword-contrast' },
  scenarios: [
    {
      ...untimed(),
      id: 'steps',
      title: 'Steps',
      status: 'success',
      description: 'Given a basket\nWhen I pay\nThen it ships\nAnd I am emailed',
      facts: [],
      metrics: [],
      participants: [
        { id: 'shopper', name: 'Shopper', type: 'actor' },
        { id: 'shop', name: 'Shop', type: 'participant' },
      ],
      events: [{ kind: 'message', id: 'm1', from: 'shopper', to: 'shop', label: 'pay', type: 'synchronous' }],
    },
    {
      ...untimed(),
      id: 'html',
      title: 'HTML narrative',
      status: 'success',
      description: 'Please <mark>note</mark> the extras',
      facts: [],
      metrics: [],
      participants: [
        { id: 'shopper', name: 'Shopper', type: 'actor' },
        { id: 'shop', name: 'Shop', type: 'participant' },
      ],
      events: [{ kind: 'message', id: 'm2', from: 'shopper', to: 'shop', label: 'pay', type: 'synchronous' }],
    },
  ],
}

/** Text and background of every visible description <mark>, as sRGB bytes.
 *  The background is composited over the mark's actual backdrop (or Canvas), so a
 *  translucent fill is not treated as an opaque colour when measuring contrast (#230). */
function narrativeMarks(page: Page): Promise<{ text: string; fg: number[]; bg: number[] }[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const paint = (color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
    }
    const read = () => [...ctx.getImageData(0, 0, 1, 1).data]
    const isOpaque = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      paint(color)
      return read()[3] === 255
    }
    const backdrop = (el: HTMLElement) => {
      let node: HTMLElement | null = el.parentElement
      while (node) {
        const bg = getComputedStyle(node).backgroundColor
        if (isOpaque(bg)) return bg
        node = node.parentElement
      }
      return 'Canvas'
    }
    return [...document.querySelectorAll<HTMLElement>('.narrative mark')].map((el) => {
      const cs = getComputedStyle(el)
      const under = backdrop(el)
      ctx.clearRect(0, 0, 1, 1)
      paint(under)
      paint(cs.backgroundColor)
      const bg = read()
      ctx.clearRect(0, 0, 1, 1)
      paint(cs.color)
      const fg = read()
      return { text: el.textContent ?? '', fg, bg }
    })
  })
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`in forced colours (${colorScheme}), the Given/When/Then keywords keep 4.5:1 contrast`, async ({ page }) => {
    await openReport(page, {
      report,
      path: '/#scenario=steps',
      media: { forcedColors: 'active', colorScheme, reducedMotion: 'reduce' },
    })
    const keywords = await narrativeMarks(page)
    expect(keywords.map((m) => m.text)).toEqual(['Given', 'When', 'Then', 'And'])
    for (const mark of keywords) {
      expect(contrastRatio(mark.fg, mark.bg), mark.text).toBeGreaterThanOrEqual(4.5)
    }
  })

  test(`in forced colours (${colorScheme}), a pass-through description mark keeps 4.5:1 contrast`, async ({ page }) => {
    await openReport(page, {
      report,
      path: '/#scenario=html',
      media: { forcedColors: 'active', colorScheme, reducedMotion: 'reduce' },
    })
    const marks = await narrativeMarks(page)
    expect(marks.map((m) => m.text)).toEqual(['note'])
    expect(contrastRatio(marks[0].fg, marks[0].bg)).toBeGreaterThanOrEqual(4.5)
  })
}

test('in forced colours, description marks use the system Mark colours', async ({ page }) => {
  await openReport(page, {
    report,
    path: '/#scenario=steps',
    media: { forcedColors: 'active', colorScheme: 'dark', reducedMotion: 'reduce' },
  })
  await page.evaluate(() => {
    const probe = document.createElement('i')
    probe.id = 'mark-probe'
    probe.style.backgroundColor = 'Mark'
    probe.style.color = 'MarkText'
    document.body.append(probe)
  })
  const [markBg, markFg, probeBg, probeFg] = await computedColours(page, [
    ['.narrative mark', 'background-color'],
    ['.narrative mark', 'color'],
    ['#mark-probe', 'background-color'],
    ['#mark-probe', 'color'],
  ])
  expect(markBg).toEqual(probeBg)
  expect(markFg).toEqual(probeFg)
})

test('without forced colours, description marks keep their accent colours in every theme', async ({ page }) => {
  for (const theme of ['dark', 'light', 'contrast'] as const) {
    await openReport(page, { report, theme, path: '/#scenario=steps' })
    await page.evaluate(() => {
      const probe = document.createElement('i')
      probe.id = 'accent-probe'
      probe.style.backgroundColor = 'var(--accent-soft)'
      probe.style.color = 'var(--accent-strong)'
      document.body.append(probe)
    })
    const [markBg, markFg, probeBg, probeFg] = await computedColours(page, [
      ['.narrative mark', 'background-color'],
      ['.narrative mark', 'color'],
      ['#accent-probe', 'background-color'],
      ['#accent-probe', 'color'],
    ])
    expect(markBg, `${theme} background`).toEqual(probeBg)
    expect(markFg, `${theme} text`).toEqual(probeFg)
    await page.evaluate(() => document.getElementById('accent-probe')?.remove())
  }
})
