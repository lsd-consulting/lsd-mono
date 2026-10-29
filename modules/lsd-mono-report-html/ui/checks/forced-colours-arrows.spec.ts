import { expect, test } from '@playwright/test'
import type { MessageEvent, MessageType, Report } from '../src/types'
import { openReport } from './open-report'
import { reportBase, untimed } from '../src/lib/report-fixture.test-util'

// In forced colours (Windows Contrast themes) every arrow is drawn in the one system text colour,
// so a call, a reply and an async message must still differ by the line's dashes and the tip's
// shape, and the queue keeps its outline.

const TYPES: MessageType[] = ['SYNCHRONOUS', 'SYNCHRONOUS_RESPONSE', 'ASYNCHRONOUS']

const report: Report = {
  ...reportBase(),
  title: 'Forced colours',
  generatedAt: '2026-01-15T12:00:00+00:00',
  generator: 'forced-colours-arrows',
  scenarios: [
    {
      ...untimed(),
      id: 's',
      title: 'Arrow kinds',
      status: 'success',
      description: 'A call, a reply and an async message.',
      facts: [],
      metrics: [],
      participants: [
        { id: 'a', name: 'Shop', type: 'PARTICIPANT', colour: '#38bdf8' },
        { id: 'b', name: 'Orders', type: 'PARTICIPANT', colour: '#16a34a' },
        { id: 'q', name: 'Order events', type: 'QUEUE' },
      ],
      events: TYPES.map((type): MessageEvent => ({
        kind: 'message',
        id: type,
        from: type === 'SYNCHRONOUS_RESPONSE' ? 'b' : 'a',
        to: type === 'SYNCHRONOUS_RESPONSE' ? 'a' : type === 'ASYNCHRONOUS' ? 'q' : 'b',
        label: type.toLowerCase(),
        type,
      })),
    },
  ],
}

for (const theme of ['dark', 'light']) {
  test(`arrow kinds keep their dashes and tips in forced colours (${theme} theme)`, async ({ page }) => {
    await openReport(page, {
      report,
      theme,
      media: { forcedColors: 'active', reducedMotion: 'reduce' },
      viewport: { width: 1280, height: 800 },
    })
    const seen = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.color = 'CanvasText'
      document.body.append(probe)
      const canvasText = getComputedStyle(probe).color
      probe.remove()
      const row = (type: string) => {
        const path = document.querySelector<SVGElement>(
          `[data-msg-type="${type}"] .msg-path, .msg-path[data-msg-type="${type}"]`,
        )!
        const marker = path.getAttribute('marker-end')!.replace(/^url\(#|\)$/g, '')
        const tip = document.getElementById(marker)!.querySelector<SVGElement>('path')!
        const tipStyle = getComputedStyle(tip)
        return {
          stroke: getComputedStyle(path).stroke,
          dash: getComputedStyle(path).strokeDasharray,
          tipClass: tip.getAttribute('class'),
          tipInk: tip.classList.contains('arrow-ink-fill') ? tipStyle.fill : tipStyle.stroke,
          tipWidth: Number(document.getElementById(marker)!.getAttribute('markerWidth')),
        }
      }
      const queue = document.querySelector('[data-participant-type="QUEUE"] .participant-shape')!
      return {
        canvasText,
        call: row('SYNCHRONOUS'),
        reply: row('SYNCHRONOUS_RESPONSE'),
        async: row('ASYNCHRONOUS'),
        queueStroke: getComputedStyle(queue).stroke,
        legend: document.querySelector('.arrow-legend')?.textContent ?? '',
      }
    })
    for (const kind of [seen.call, seen.reply, seen.async]) {
      expect(kind.stroke).toBe(seen.canvasText)
      expect(kind.tipInk).toBe(seen.canvasText)
    }
    expect(seen.queueStroke).toBe(seen.canvasText)
    expect(seen.call.dash).toBe('none')
    expect(seen.reply.dash.replace(/px/g, '')).toBe('5, 4')
    expect(seen.async.dash.replace(/px/g, '')).toBe('2, 4')
    expect(seen.call.tipClass).toContain('arrow-ink-fill')
    expect(seen.async.tipClass).toContain('arrow-ink-stroke')
    expect(seen.async.tipWidth).toBeGreaterThan(seen.call.tipWidth)
    expect(seen.legend).toContain('Async (dotted, open tip)')
  })
}
