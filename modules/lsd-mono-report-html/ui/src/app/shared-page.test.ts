// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { adoptSharedReport } from './shared-page'
import type { ReportJson } from '../types'

const report = {
  schemaVersion: '1.0.0',
  title: 'Shop',
  generatedAt: '',
  generator: { name: 't' },
  status: 'success',
} as ReportJson

function page(stem: string | null): Window {
  document.head.innerHTML = stem === null ? '' : `<meta name="lsd-report" content="${stem}">`
  for (const key of ['__LSD_REPORT__', '__LSD_INDEX__', '__LSD_REPORTS__', '__LSD_PAYLOADS_SRC__'] as const)
    delete window[key]
  return window
}

describe('adoptSharedReport', () => {
  beforeEach(() => page(null))

  it("takes the page's report and payloads file from <stem>-report.js", () => {
    const win = page('Shop-1a2b3c4d')
    win.__LSD_REPORTS__ = {
      'Other-00000000': { report: { ...report, title: 'Other' }, payloadsSrc: null },
      'Shop-1a2b3c4d': { report, payloadsSrc: 'Shop-1a2b3c4d-payloads.js' },
    }
    adoptSharedReport(win, document)
    expect(win.__LSD_REPORT__).toBe(report)
    expect(win.__LSD_PAYLOADS_SRC__).toBe('Shop-1a2b3c4d-payloads.js')
  })

  it('leaves the payloads file unset when the report has none', () => {
    const win = page('Shop-1a2b3c4d')
    win.__LSD_REPORTS__ = { 'Shop-1a2b3c4d': { report, payloadsSrc: null } }
    adoptSharedReport(win, document)
    expect(win.__LSD_REPORT__).toBe(report)
    expect(win.__LSD_PAYLOADS_SRC__).toBeUndefined()
  })

  it('names the missing data file instead of showing the demo', () => {
    const win = page('Shop-1a2b3c4d')
    adoptSharedReport(win, document)
    expect(win.__LSD_REPORT__).toMatchObject({
      title: 'Report data not found: Shop-1a2b3c4d-report.js',
      status: 'error',
    })
    expect((win.__LSD_REPORT__ as ReportJson).scenarios?.[0]?.description).toContain(
      'copy or publish the whole directory',
    )
  })

  it('changes nothing on a single-file page, an index or a page with no report named', () => {
    const inline = page('Shop-1a2b3c4d')
    inline.__LSD_REPORT__ = report
    inline.__LSD_REPORTS__ = { 'Shop-1a2b3c4d': { report: { ...report, title: 'not me' }, payloadsSrc: null } }
    adoptSharedReport(inline, document)
    expect(inline.__LSD_REPORT__).toBe(report)

    const index = page('Shop-1a2b3c4d')
    index.__LSD_INDEX__ = { reports: [] } as unknown as Window['__LSD_INDEX__']
    adoptSharedReport(index, document)
    expect(index.__LSD_REPORT__).toBeUndefined()

    const demo = page(null)
    adoptSharedReport(demo, document)
    expect(demo.__LSD_REPORT__).toBeUndefined()
  })
})
