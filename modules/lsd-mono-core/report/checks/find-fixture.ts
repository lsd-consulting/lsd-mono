import type { Page } from '@playwright/test'
import type { IndexManifest } from '../src/lib/report-index'
import { payloadTextScript } from '../src/lib/payloads'
import type { Report } from '../src/types'
import { openReport } from './open-report'

/**
 * A report for Find in payloads (#60). It keeps one payload in its sibling script (loaded the first
 * time Find is used) and the rest on the messages, as a captured report does. "snowdrop" is in two
 * payloads and one label; "sock-1" only in payloads.
 */
const deferred = {
  'find/m1': { method: 'POST', path: '/orders', body: { voucher: 'SNOWDROP-10', sku: 'SOCK-1' } },
}

export const findReport: Report = {
  title: 'Find',
  generatedAt: '2026-01-15T12:00:00+00:00',
  generator: 'ux-fixture',
  scenarios: [
    {
      id: 'find',
      title: 'Find in payloads',
      status: 'success',
      description: '',
      facts: [],
      metrics: [],
      participants: [
        { id: 'a', name: 'Client', type: 'PARTICIPANT' },
        { id: 'b', name: 'Orders', type: 'PARTICIPANT' },
        { id: 'c', name: 'Stock', type: 'DATABASE' },
      ],
      events: [
        {
          kind: 'message',
          id: 'm1',
          from: 'a',
          to: 'b',
          label: 'place order',
          type: 'SYNCHRONOUS',
          payloadId: 'find/m1',
        },
        {
          kind: 'message',
          id: 'm2',
          from: 'b',
          to: 'c',
          label: 'reserve stock',
          type: 'SYNCHRONOUS',
          data: { sku: 'SOCK-1', note: 'snowdrop gift wrap', lines: ['SNOWDROP card', 'ribbon', 'snowdrop tag'] },
        },
        { kind: 'message', id: 'm3', from: 'c', to: 'b', label: 'reserved', type: 'SYNCHRONOUS_RESPONSE' },
        {
          kind: 'message',
          id: 'm4',
          from: 'b',
          to: 'a',
          label: 'snowdrop applied',
          type: 'SYNCHRONOUS_RESPONSE',
          data: { ok: true },
        },
      ],
    },
  ],
}

/**
 * The sibling payload script as the core writes it now (`__LSD_PAYLOAD_TEXT__`), or as a report
 * from before #63 wrote it (`__LSD_PAYLOADS__`), which an index page can still list.
 */
function payloadsScript(legacy: boolean): string {
  return legacy ? `window.__LSD_PAYLOADS__=${JSON.stringify(deferred)};` : payloadTextScript(deferred)
}

export async function openFindReport(page: Page, theme = 'light'): Promise<void> {
  await openReport(page, {
    report: findReport,
    theme,
    payloads: { src: 'find-payloads.js', body: payloadsScript(false) },
  })
}

export async function openFindIndex(page: Page, { legacy = false } = {}): Promise<void> {
  const manifest: IndexManifest = {
    title: 'LSD reports',
    generatedAt: findReport.generatedAt,
    generator: 'ux-fixture',
    reports: [
      {
        id: 'find',
        title: 'Find',
        status: 'success',
        href: 'find-diagram.html',
        data: 'find-report.js',
        counts: { success: 1, warn: 0, error: 0 },
        scenarios: [{ id: 'find', title: 'Find in payloads', status: 'success', messages: 4 }],
      },
    ],
  }
  await openReport(page, {
    index: { manifest, reports: { find: findReport } },
    payloads: { src: 'find-payloads.js', body: payloadsScript(legacy) },
  })
}
