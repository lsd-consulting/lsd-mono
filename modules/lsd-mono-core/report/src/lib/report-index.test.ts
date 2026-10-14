// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { Report } from '../types'
import { loadExternalPayloads, loadPayloadsFrom, resetPayloadCache } from './payloads'
import {
  addScript,
  defaultReportId,
  indexTotals,
  loadReportData,
  resetReportDataCache,
  visibleScenarios,
  type IndexManifest,
  type IndexReport,
} from './report-index'

const ALL = { success: true, warn: true, error: true }

function entry(
  id: string,
  title: string,
  scenarios: IndexReport['scenarios'],
  data: string | null = `${id}-report.js`,
): IndexReport {
  const counts = { success: 0, warn: 0, error: 0 }
  for (const s of scenarios) counts[s.status]++
  const status = counts.error ? 'error' : counts.warn ? 'warn' : 'success'
  return { id, title, status, href: `${id}-diagram.html`, data: data ?? undefined, counts, scenarios }
}

const checkout = entry('checkout', 'Checkout tests', [
  { id: 's1', title: 'Place an order', status: 'success', messages: 2 },
  { id: 's2', title: 'Card declined', status: 'error', messages: 3 },
])
const shipping = entry('shipping', 'Shipping tests', [{ id: 's1', title: 'Track parcel', status: 'warn', messages: 1 }])
const link = entry('legacy', 'Elsewhere', [], null)
const manifest: IndexManifest = {
  title: 'LSD reports',
  generatedAt: '',
  generator: 'test',
  reports: [link, checkout, shipping],
}

/** Stand in for the browser running a classic script: run what the src would hold, then fire load. */
function serveScripts(files: Record<string, () => void>): void {
  const original = document.head.appendChild.bind(document.head)
  document.head.appendChild = <T extends Node>(node: T): T => {
    // Take the src off so happy-dom does not try to fetch it; the marker attribute stays.
    const src = node instanceof HTMLScriptElement ? (node.getAttribute('src') ?? '') : ''
    if (src && node instanceof HTMLScriptElement) node.removeAttribute('src')
    const added = original(node)
    if (src) {
      const body = files[src]
      queueMicrotask(() => {
        if (body === undefined) node.dispatchEvent(new Event('error'))
        else {
          body()
          node.dispatchEvent(new Event('load'))
        }
      })
    }
    return added
  }
}

afterEach(() => {
  resetReportDataCache()
  resetPayloadCache()
  delete window.__LSD_REPORTS__
  delete window.__LSD_PAYLOADS__
  document.head.innerHTML = ''
})

describe('index manifest', () => {
  it('adds up scenarios by outcome across reports', () => {
    expect(indexTotals(manifest)).toEqual({ success: 1, warn: 1, error: 1 })
  })

  it('opens the first report that has data', () => {
    expect(defaultReportId(manifest)).toBe('checkout')
    expect(defaultReportId({ ...manifest, reports: [link] })).toBeNull()
  })

  it('lists scenarios by status and by a query on the scenario or report title', () => {
    expect(visibleScenarios(checkout, { query: '', status: ALL }).map((s) => s.id)).toEqual(['s1', 's2'])
    expect(visibleScenarios(checkout, { query: '', status: { ...ALL, success: false } }).map((s) => s.id)).toEqual([
      's2',
    ])
    expect(visibleScenarios(checkout, { query: 'DECLINED', status: ALL }).map((s) => s.id)).toEqual(['s2'])
    expect(visibleScenarios(checkout, { query: 'checkout', status: ALL })).toHaveLength(2)
    expect(visibleScenarios(shipping, { query: 'order', status: ALL })).toEqual([])
  })

  it('matches the open report on what only its loaded data holds', () => {
    const facts = (id: string, q: string) => id === 's1' && q === 'ord-1001'
    expect(visibleScenarios(checkout, { query: 'ord-1001', status: ALL }, facts).map((s) => s.id)).toEqual(['s1'])
  })
})

describe('loading a report', () => {
  const report: Report = { title: 'Checkout tests', generatedAt: '', generator: 'test', scenarios: [] }

  it('adds the data script once and returns what it registered', async () => {
    serveScripts({
      'checkout-report.js': () => {
        ;(window.__LSD_REPORTS__ ??= {}).checkout = { report, payloadsSrc: 'checkout-payloads.js' }
      },
    })
    const first = await loadReportData(checkout)
    expect(first.report.title).toBe('Checkout tests')
    expect(first.payloadsSrc).toBe('checkout-payloads.js')
    expect(await loadReportData(checkout)).toBe(first)
    expect(document.querySelectorAll('script[data-lsd-report]')).toHaveLength(1)
  })

  it('rejects when there is no data script, when it fails to load, or when it registers nothing, and can retry', async () => {
    await expect(loadReportData(link)).rejects.toThrow('has no data script')
    serveScripts({ 'shipping-report.js': () => {} })
    await expect(loadReportData(checkout)).rejects.toThrow('Could not load checkout-report.js')
    await expect(loadReportData(shipping)).rejects.toThrow('did not register report shipping')
    window.__LSD_REPORTS__ = { shipping: { report, payloadsSrc: null } }
    expect((await loadReportData(shipping)).payloadsSrc).toBeNull()
  })

  it('keeps each report’s payloads apart even though every payload script assigns the same global', async () => {
    serveScripts({
      'a-payloads.js': () => {
        window.__LSD_PAYLOADS__ = { 's1/m1': { from: 'a' } }
      },
      'b-payloads.js': () => {
        window.__LSD_PAYLOADS__ = { 's1/m1': { from: 'b' } }
      },
    })
    const [a, b] = await Promise.all([loadPayloadsFrom('a-payloads.js'), loadPayloadsFrom('b-payloads.js')])
    expect(a['s1/m1']).toEqual({ from: 'a' })
    expect(b['s1/m1']).toEqual({ from: 'b' })
    expect(await loadPayloadsFrom('a-payloads.js')).toBe(a)
    expect(window.__LSD_PAYLOADS__).toBeUndefined()
  })

  it('forgets a payload script that failed, so opening the message again retries it', async () => {
    serveScripts({})
    await expect(loadPayloadsFrom('late-payloads.js')).rejects.toThrow('Could not load payloads from late-payloads.js')
    serveScripts({
      'late-payloads.js': () => {
        window.__LSD_PAYLOADS__ = { 's/m': 1 }
      },
    })
    expect(await loadPayloadsFrom('late-payloads.js')).toEqual({ 's/m': 1 })
  })

  it('a payload script that assigns nothing gives no payloads', async () => {
    serveScripts({ 'empty-payloads.js': () => {} })
    expect(await loadPayloadsFrom('empty-payloads.js')).toEqual({})
  })

  it('replaces a script element left from a failed attempt', async () => {
    serveScripts({})
    await expect(addScript('x.js', 'data-test')).rejects.toThrow('Could not load x.js')
    expect(document.querySelectorAll('script[data-test]')).toHaveLength(0)
  })
})

describe('loadExternalPayloads', () => {
  afterEach(() => {
    delete window.__LSD_PAYLOADS_SRC__
  })

  it('uses payloads already on the page', async () => {
    window.__LSD_PAYLOADS__ = { 's/m': 'inline' }
    expect(await loadExternalPayloads(false)).toEqual({ 's/m': 'inline' })
  })

  it('has nothing to load without a payload script or the sample', async () => {
    expect(await loadExternalPayloads(false)).toEqual({})
  })

  it('loads the sibling payload script, and tries again after a failure', async () => {
    window.__LSD_PAYLOADS_SRC__ = 'report-payloads.js'
    serveScripts({})
    await expect(loadExternalPayloads(false)).rejects.toThrow('Could not load payloads from report-payloads.js')
    serveScripts({
      'report-payloads.js': () => {
        window.__LSD_PAYLOADS__ = { 's/m': 2 }
      },
    })
    expect(await loadExternalPayloads(false)).toEqual({ 's/m': 2 })
  })
})
