import type { Page } from '@playwright/test'
import type { IndexManifest } from '../src/lib/report-index'
import type { DiagramEvent, Report } from '../src/types'

/** Three titled sections of [perSection] calls each, every call with a body. */
export function sectionsReport(perSection: number): Report {
  const events: DiagramEvent[] = []
  for (const s of [1, 2, 3]) {
    events.push({ kind: 'section', id: `s${s}`, title: `Part ${s}` })
    for (let i = 0; i < perSection; i++)
      events.push({
        kind: 'message',
        id: `m${s}-${i}`,
        from: 'a',
        to: 'b',
        label: `call ${s}.${i}`,
        type: 'SYNCHRONOUS',
        data: { n: i },
      })
  }
  return {
    title: 'Sections',
    generatedAt: '2026-01-15T12:00:00+00:00',
    generator: 'ux-fixture',
    scenarios: [
      {
        id: 'sections',
        title: 'Sections',
        status: 'success',
        description: '',
        facts: [],
        metrics: [],
        participants: [
          { id: 'a', name: 'Client', type: 'PARTICIPANT' },
          { id: 'b', name: 'Server', type: 'PARTICIPANT' },
        ],
        events,
      },
    ],
  }
}

export async function openReport(page: Page, report: Report): Promise<void> {
  await page.addInitScript((r) => {
    window.__LSD_REPORT__ = r
  }, report)
  await page.goto('/')
}

export async function openIndex(page: Page, report: Report): Promise<void> {
  const manifest: IndexManifest = {
    title: 'LSD reports',
    generatedAt: report.generatedAt,
    generator: 'ux-fixture',
    reports: [
      {
        id: 'sections',
        title: 'Sections',
        status: 'success',
        href: 'sections-diagram.html',
        data: 'sections-report.js',
        counts: { success: 1, warn: 0, error: 0 },
        scenarios: [{ id: 'sections', title: 'Sections', status: 'success', messages: 0 }],
      },
    ],
  }
  await page.addInitScript((m) => {
    window.__LSD_INDEX__ = m
  }, manifest)
  await page.route('**/sections-report.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `(window.__LSD_REPORTS__=window.__LSD_REPORTS__||{}).sections={report:${JSON.stringify(report)},payloadsSrc:null};`,
    }),
  )
  await page.goto('/')
}
