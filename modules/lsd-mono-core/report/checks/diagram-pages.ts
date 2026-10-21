import type { Page } from '@playwright/test'
import type { IndexManifest } from '../src/lib/report-index'
import type { DiagramEvent, Report } from '../src/types'
import { openReport, type OpenOptions } from './open-report'
import { indexBase, reportBase, untimed } from '../src/lib/report-fixture.test-util'

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
    ...reportBase(),
    title: 'Sections',
    generatedAt: '2026-01-15T12:00:00+00:00',
    generator: 'ux-fixture',
    scenarios: [
      {
        ...untimed(),
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

/** An index page listing [report] as its one report, id "sections", loaded when opened. */
export function sectionsIndex(report: Report): NonNullable<OpenOptions['index']> {
  const manifest: IndexManifest = {
    ...indexBase(),
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
  return { manifest, reports: { sections: report } }
}

type PageOpener = (page: Page, report: Report, options?: OpenOptions) => Promise<unknown>

/** The same report as a single-report page and as an index page, for checks that run on both. */
export const PAGES: Record<'report' | 'index', PageOpener> = {
  report: (page, report, options) => openReport(page, { ...options, report }),
  index: (page, report, options) => openReport(page, { ...options, index: sectionsIndex(report) }),
}
