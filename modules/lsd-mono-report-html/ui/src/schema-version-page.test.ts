// @vitest-environment happy-dom
// The whole page booted on a report or index of another schema version (lib/schema-version.ts):
// a newer minor version is shown with a notice, a newer major version or a version that is not
// one gets the upgrade page and never a blank one, on the single-report page and on the index
// page. The upgrade page sends no usage ping.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexManifest } from './lib/report-index'
import { indexBase, reportBase, untimed } from './lib/report-fixture.test-util'
import { REPORT_SCHEMA_VERSION, type Report } from './types'

const [major, minor] = REPORT_SCHEMA_VERSION.split('.').map(Number)
const NEWER_MINOR = `${major}.${minor + 1}.0`
const NEWER_MAJOR = `${major + 1}.0.0`

function report(schemaVersion: string): Report {
  return {
    ...reportBase(),
    schemaVersion,
    title: 'Checkout',
    generatedAt: '2026-01-01T12:00:00Z',
    generator: { name: 'lsd-mono-jvm', version: '9.0.0' },
    scenarios: [
      {
        ...untimed(),
        id: 'pay',
        title: 'Pay',
        status: 'success',
        description: '',
        facts: [],
        metrics: [],
        participants: [{ id: 'a', name: 'A', type: 'actor' }],
        events: [{ kind: 'message', id: 'm1', from: 'a', to: 'a', label: 'think', type: 'synchronous' }],
      },
    ],
  }
}

function manifest(schemaVersion: string): IndexManifest {
  return {
    ...indexBase(),
    schemaVersion,
    title: 'LSD reports',
    generatedAt: '2026-01-01T12:00:00Z',
    generator: { name: 'lsd-mono-jvm', version: '9.0.0' },
    reports: [
      {
        id: 'checkout',
        title: 'Checkout',
        status: 'success',
        href: 'checkout-diagram.html',
        data: 'checkout-report.js',
        counts: { success: 1, warn: 0, error: 0, skipped: 0, aborted: 0 },
        scenarios: [{ id: 'pay', title: 'Pay', status: 'success', messageCount: 1 }],
      },
    ],
  }
}

const errors: unknown[] = []

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  window.location.hash = ''
  errors.length = 0
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args))
})

afterEach(() => {
  delete window.__LSD_REPORT__
  delete window.__LSD_INDEX__
  delete window.__LSD_REPORTS__
  vi.restoreAllMocks()
})

/** The page's pinger, spied on: import it after resetModules and before main, so main gets this one. */
async function spyOnUsage() {
  const { usage } = await import('./lib/usage-ping')
  return { configure: vi.spyOn(usage, 'configure'), ping: vi.spyOn(usage, 'ping') }
}

const text = (selector: string) => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim()

describe('a report page', () => {
  it('shows a report of this version with no notice', async () => {
    window.__LSD_REPORT__ = report(REPORT_SCHEMA_VERSION)
    await import('./main')
    expect(document.querySelector('.scenario-card')).not.toBeNull()
    expect(document.querySelector('.schema-notice')).toBeNull()
    expect(errors).toEqual([])
  })

  it('shows a report of a newer minor version, with a notice that does not block it', async () => {
    window.__LSD_REPORT__ = report(NEWER_MINOR)
    await import('./main')
    expect(document.querySelector('.scenario-card')).not.toBeNull()
    expect(text('.schema-notice')).toContain(`report format ${NEWER_MINOR}`)
    expect(errors).toEqual([])
  })

  it('shows the upgrade page for a report of a newer major version, whatever its shape', async () => {
    window.__LSD_REPORT__ = { schemaVersion: NEWER_MAJOR, reports: 'not what this page knows' } as unknown as Report
    await import('./main')
    expect(text('h1')).toBe('Upgrade lsd-mono to open this report')
    expect(text('.schema-upgrade')).toContain(`report format ${NEWER_MAJOR}`)
    expect(document.querySelector('.scenario-card')).toBeNull()
    expect(document.title).toBe('Upgrade lsd-mono · LSD report')
    expect(errors).toEqual([])
  })

  it('says a report whose version is not one cannot be opened, and does not blame a new major', async () => {
    window.__LSD_REPORT__ = report('v2')
    await import('./main')
    expect(text('h1')).toBe('This report cannot be opened')
    expect(text('.schema-upgrade')).toContain('Its report format, v2, is not a version number')
    expect(text('.schema-upgrade')).not.toContain('new major version')
    expect(document.querySelector('.scenario-card')).toBeNull()
    expect(errors).toEqual([])
  })

  it('sends no usage ping from the upgrade page, though a readable release report would', async () => {
    window.__LSD_REPORT__ = {
      ...report(REPORT_SCHEMA_VERSION),
      generator: { name: 'lsd-mono-jvm', version: '9.0.0' },
      options: { metricsEnabled: true, labelMaxChars: 200, usagePing: true },
    }
    let usage = await spyOnUsage()
    await import('./main')
    expect(usage.configure).toHaveBeenCalled()
    expect(usage.ping).toHaveBeenCalledWith('report-open')

    vi.resetModules()
    document.body.innerHTML = '<div id="app"></div>'
    window.__LSD_REPORT__ = { ...window.__LSD_REPORT__, schemaVersion: NEWER_MAJOR }
    usage = await spyOnUsage()
    await import('./main')
    expect(text('h1')).toBe('Upgrade lsd-mono to open this report')
    expect(usage.configure).not.toHaveBeenCalled()
    expect(usage.ping).not.toHaveBeenCalled()
  })
})

describe('an index page', () => {
  it('shows the upgrade page for an index of a newer major version', async () => {
    window.__LSD_INDEX__ = { ...manifest(NEWER_MAJOR), reports: undefined }
    await import('./main')
    expect(text('h1')).toBe('Upgrade lsd-mono to open this index')
    expect(errors).toEqual([])
  })

  it('notes an index of a newer minor version before a report is chosen, and with none written', async () => {
    window.__LSD_INDEX__ = { ...manifest(NEWER_MINOR), reports: [] }
    await import('./main')
    expect(text('#main .schema-notice')).toContain('This index was written by a newer lsd-mono')
    expect(text('#main .empty')).toBe('No reports have been written to this directory yet.')
    expect(errors).toEqual([])
  })

  it('notes an index of a newer minor version', async () => {
    window.__LSD_INDEX__ = manifest(NEWER_MINOR)
    window.__LSD_REPORTS__ = { checkout: { report: report(REPORT_SCHEMA_VERSION), payloadsSrc: null } }
    await import('./main')
    await vi.waitFor(() => expect(document.querySelector('.scenario-card')).not.toBeNull())
    expect(text('.schema-notice')).toContain('This index was written by a newer lsd-mono')
    expect(document.querySelectorAll('.schema-notice')).toHaveLength(1)
  })

  it('opens a report of a newer minor version with a notice, and one of a newer major version not at all', async () => {
    window.__LSD_INDEX__ = {
      ...manifest(REPORT_SCHEMA_VERSION),
      reports: [manifest('').reports[0], { ...manifest('').reports[0], id: 'refunds', title: 'Refunds' }],
    }
    window.__LSD_REPORTS__ = {
      checkout: { report: report(NEWER_MINOR), payloadsSrc: null },
      refunds: { report: { schemaVersion: NEWER_MAJOR } as unknown as Report, payloadsSrc: null },
    }
    const { openReport } = await import('./app/nav')
    await import('./main')
    await openReport('checkout')
    expect(document.querySelector('.scenario-card')).not.toBeNull()
    expect(text('.schema-notice')).toContain(`report format ${NEWER_MINOR}`)
    await openReport('refunds')
    expect(text('#main h2')).toBe('Upgrade lsd-mono to open this report')
    expect(document.querySelector('#main .scenario-card')).toBeNull()
    expect(errors).toEqual([])
  })
})
