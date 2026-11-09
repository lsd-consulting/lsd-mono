// @vitest-environment happy-dom
// An in-flight index report load must not overwrite a newer selection (#236).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { indexBase, reportBase, untimed } from '../lib/report-fixture.test-util'
import type { IndexManifest } from '../lib/report-index'
import { REPORT_SCHEMA_VERSION, type Report } from '../types'

function scenario(id: string, title: string, label: string): Report['scenarios'][number] {
  return {
    ...untimed(),
    id,
    title,
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants: [
      { id: 'a', name: 'A', type: 'actor' },
      { id: 'b', name: 'B', type: 'participant' },
    ],
    events: [{ kind: 'message', id: `${id}-m1`, from: 'a', to: 'b', label, type: 'synchronous' }],
  }
}

function report(id: string, title: string, scenarioId: string, scenarioTitle: string): Report {
  return {
    ...reportBase(),
    schemaVersion: REPORT_SCHEMA_VERSION,
    title,
    generatedAt: '2026-01-01T12:00:00Z',
    generator: { name: 'lsd-mono-jvm', version: '9.0.0' },
    scenarios: [scenario(scenarioId, scenarioTitle, title.toLowerCase())],
  }
}

const alpha = report('alpha', 'Alpha', 'a1', 'Alpha scenario')
const beta = report('beta', 'Beta', 'b1', 'Beta scenario')

const manifest: IndexManifest = {
  ...indexBase(),
  title: 'LSD reports',
  generatedAt: '2026-01-01T12:00:00Z',
  generator: { name: 'lsd-mono-jvm', version: '9.0.0' },
  reports: [
    {
      id: 'alpha',
      title: 'Alpha',
      status: 'success',
      href: 'alpha-diagram.html',
      data: 'alpha-report.js',
      counts: { success: 1, warn: 0, error: 0, skipped: 0, aborted: 0 },
      scenarios: [{ id: 'a1', title: 'Alpha scenario', status: 'success', messageCount: 1 }],
    },
    {
      id: 'beta',
      title: 'Beta',
      status: 'success',
      href: 'beta-diagram.html',
      data: 'beta-report.js',
      counts: { success: 1, warn: 0, error: 0, skipped: 0, aborted: 0 },
      scenarios: [{ id: 'b1', title: 'Beta scenario', status: 'success', messageCount: 1 }],
    },
  ],
}

const heading = () => document.querySelector('#main h1')?.textContent?.trim()
const mainText = () => document.querySelector('#main')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  window.__LSD_INDEX__ = manifest
  window.__LSD_REPORTS__ = {
    alpha: { report: alpha, payloadsSrc: null },
    beta: { report: beta, payloadsSrc: null },
  }
  delete window.__LSD_REPORT__
  window.location.hash = '#report=alpha&scenario=a1'
})

afterEach(() => {
  delete window.__LSD_INDEX__
  delete window.__LSD_REPORTS__
  delete window.__LSD_REPORT__
  vi.restoreAllMocks()
})

async function bootIndex() {
  const nav = await import('./nav')
  await import('../main')
  await vi.waitFor(() => expect(heading()).toBe('Alpha'))
  return nav
}

describe('an in-flight index report load', () => {
  it('does not replace Alpha when Beta later succeeds', async () => {
    const { openReport } = await bootIndex()
    const pending = openReport('beta')
    document.querySelector<HTMLButtonElement>('[data-report="alpha"][data-nav="a1"]')!.click()
    await pending
    expect(heading()).toBe('Alpha')
    expect(mainText()).toContain('Alpha scenario')
    expect(window.location.hash).toBe('#report=alpha&scenario=a1')
    expect(mainText()).not.toContain('Could not load Beta')
  })

  it('does not replace Alpha when Beta later fails', async () => {
    const reportIndex = await import('../lib/report-index')
    const load = reportIndex.loadReportData
    const { openReport } = await bootIndex()
    vi.spyOn(reportIndex, 'loadReportData').mockImplementation((entry) => {
      if (entry.id === 'beta') return Promise.resolve().then(() => Promise.reject(new Error('synthetic-load-failure')))
      return load(entry)
    })
    const pending = openReport('beta')
    document.querySelector<HTMLButtonElement>('[data-report="alpha"][data-nav="a1"]')!.click()
    await pending
    expect(heading()).toBe('Alpha')
    expect(mainText()).toContain('Alpha scenario')
    expect(mainText()).not.toContain('Could not load Beta')
    expect(window.location.hash).toBe('#report=alpha&scenario=a1')
  })

  it('opens Beta when it is chosen while Alpha is still loading', async () => {
    const { openReport } = await bootIndex()
    const pendingAlpha = openReport('alpha')
    const pendingBeta = openReport('beta')
    await pendingAlpha
    await pendingBeta
    expect(heading()).toBe('Beta')
    expect(mainText()).toContain('Beta scenario')
  })

  it('still opens the report that remains the latest choice, including a message link', async () => {
    const { openReport } = await bootIndex()
    await openReport('beta', { reportId: 'beta', scenarioId: 'b1', messageId: 'b1-m1' })
    expect(heading()).toBe('Beta')
    expect(mainText()).toContain('Beta scenario')
    expect(window.location.hash).toContain('report=beta')
  })
})
