// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Report } from '../types'
import { lazyPayloads, loadExternalPayloads, loadPayloadsFrom, payloadTextScript, resetPayloadCache } from './payloads'
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
import { indexBase, reportBase } from './report-fixture.test-util'

const ALL = { success: true, warn: true, error: true, skipped: true, aborted: true }

function entry(
  id: string,
  title: string,
  scenarios: IndexReport['scenarios'],
  data: string | null = `${id}-report.js`,
): IndexReport {
  const counts = { success: 0, warn: 0, error: 0, skipped: 0, aborted: 0 }
  for (const s of scenarios) counts[s.status]++
  const status = counts.error ? 'error' : counts.warn ? 'warn' : 'success'
  return { id, title, status, href: `${id}-diagram.html`, data: data ?? undefined, counts, scenarios }
}

const checkout = entry('checkout', 'Checkout tests', [
  { id: 's1', title: 'Place an order', status: 'success', messageCount: 2 },
  { id: 's2', title: 'Card declined', status: 'error', messageCount: 3 },
])
const shipping = entry('shipping', 'Shipping tests', [
  { id: 's1', title: 'Track parcel', status: 'warn', messageCount: 1 },
])
const link = entry('legacy', 'Elsewhere', [], null)
const manifest: IndexManifest = {
  ...indexBase(),
  title: 'LSD reports',
  generatedAt: '',
  generator: { name: 'test' },
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
  delete window.__LSD_PAYLOAD_TEXT__
  document.head.innerHTML = ''
})

describe('index manifest', () => {
  it('adds up scenarios by outcome across reports', () => {
    expect(indexTotals(manifest)).toEqual({ success: 1, warn: 1, error: 1, skipped: 0, aborted: 0 })
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
  const report: Report = {
    ...reportBase(),
    title: 'Checkout tests',
    generatedAt: '',
    generator: { name: 'test' },
    scenarios: [],
  }

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

describe('payload text (#63)', () => {
  it('writes each payload as JSON text and parses one only when it is read, once', () => {
    const script = payloadTextScript({ 's/m1': { body: '</script>', n: 1 }, 's/m2': 'plain' })
    expect(script.startsWith('window.__LSD_PAYLOAD_TEXT__=')).toBe(true)
    expect(script).not.toContain('</script>')
    // What the script assigns: a JSON object of strings.
    const text = JSON.parse(script.slice('window.__LSD_PAYLOAD_TEXT__='.length, -2)) as Record<string, string>
    expect(text['s/m1']).toBe('{"body":"</script>","n":1}')
    const parse = vi.spyOn(JSON, 'parse')
    const payloads = lazyPayloads(text)
    expect(Object.keys(payloads)).toEqual(['s/m1', 's/m2'])
    expect(parse).not.toHaveBeenCalled()
    expect(payloads['s/m2']).toBe('plain')
    expect(parse).toHaveBeenCalledTimes(1)
    const first = payloads['s/m1']
    expect(first).toEqual({ body: '</script>', n: 1 })
    expect(payloads['s/m1']).toBe(first)
    expect(parse).toHaveBeenCalledTimes(2)
    expect('s/m3' in payloads).toBe(false)
    parse.mockRestore()
  })

  it('drops each text once parsed, and shows text that is not JSON as it is with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const text: Record<string, string> = { 's/ok': '{"a":1}', 's/bad': '{"a":', 's/worse': 'not json' }
    const payloads = lazyPayloads(text)
    expect(payloads['s/ok']).toEqual({ a: 1 })
    expect(Object.keys(text)).toEqual(['s/bad', 's/worse'])
    expect(payloads['s/bad']).toBe('{"a":')
    expect(payloads['s/worse']).toBe('not json')
    expect(payloads['s/bad']).toBe('{"a":')
    expect(text).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('s/bad')
    warn.mockRestore()
  })

  it('loads a payload text script on the report page and on the index page, beside older scripts', async () => {
    window.__LSD_PAYLOADS_SRC__ = 'text-payloads.js'
    serveScripts({
      'text-payloads.js': () => {
        window.__LSD_PAYLOAD_TEXT__ = { 's/m': '{"from":"text"}' }
      },
      'index-text-payloads.js': () => {
        window.__LSD_PAYLOAD_TEXT__ = { 's/m': '{"from":"index"}' }
      },
      'old-payloads.js': () => {
        window.__LSD_PAYLOADS__ = { 's/m': { from: 'old' } }
      },
    })
    expect((await loadExternalPayloads(false))['s/m']).toEqual({ from: 'text' })
    resetPayloadCache()
    delete window.__LSD_PAYLOADS__
    const [text, old] = await Promise.all([
      loadPayloadsFrom('index-text-payloads.js'),
      loadPayloadsFrom('old-payloads.js'),
    ])
    expect(text['s/m']).toEqual({ from: 'index' })
    expect(old['s/m']).toEqual({ from: 'old' })
    expect(window.__LSD_PAYLOAD_TEXT__).toBeUndefined()
    delete window.__LSD_PAYLOADS_SRC__
  })
})
