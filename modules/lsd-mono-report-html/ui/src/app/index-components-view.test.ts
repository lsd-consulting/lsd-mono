// @vitest-environment happy-dom
// An index `#report=&scenario=&view=components` link opens Components, not Sequence (#237).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { indexBase, reportBase, untimed } from '../lib/report-fixture.test-util'
import type { IndexManifest } from '../lib/report-index'
import { REPORT_SCHEMA_VERSION, type Report } from '../types'

function shopReport(): Report {
  return {
    ...reportBase(),
    schemaVersion: REPORT_SCHEMA_VERSION,
    title: 'Shop',
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
        participants: [
          { id: 'web', name: 'Web', type: 'actor' },
          { id: 'api', name: 'Api', type: 'participant' },
        ],
        events: [{ kind: 'message', id: 'm1', from: 'web', to: 'api', label: 'POST /pay', type: 'synchronous' }],
      },
      {
        ...untimed([]),
        id: 'notes',
        title: 'Notes',
        status: 'success',
        description: '',
        facts: [],
        metrics: [],
        participants: [{ id: 'web', name: 'Web', type: 'actor' }],
        events: [],
      },
    ],
  }
}

const manifest: IndexManifest = {
  ...indexBase(),
  title: 'LSD reports',
  generatedAt: '2026-01-01T12:00:00Z',
  generator: { name: 'lsd-mono-jvm', version: '9.0.0' },
  reports: [
    {
      id: 'shop',
      title: 'Shop',
      status: 'success',
      href: 'shop-diagram.html',
      data: 'shop-report.js',
      counts: { success: 2, warn: 0, error: 0, skipped: 0, aborted: 0 },
      scenarios: [
        { id: 'pay', title: 'Pay', status: 'success', messageCount: 1 },
        { id: 'notes', title: 'Notes', status: 'success', messageCount: 0 },
      ],
    },
    {
      id: 'cart',
      title: 'Cart',
      status: 'success',
      href: 'cart-diagram.html',
      data: 'cart-report.js',
      counts: { success: 1, warn: 0, error: 0, skipped: 0, aborted: 0 },
      scenarios: [{ id: 'c1', title: 'Cart scenario', status: 'success', messageCount: 1 }],
    },
  ],
}

const shownView = () => document.querySelector<HTMLElement>('#main .diagram-panel')?.dataset.view
const diagramHeading = () => document.querySelector('#main .diagram-panel h3')?.textContent?.trim()
const componentsPaneHidden = () =>
  document.querySelector<HTMLElement>('#main .diagram-pane[data-pane="components"]')?.hidden

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  window.location.hash = ''
  delete window.__LSD_REPORT__
  delete window.__LSD_INDEX__
  delete window.__LSD_REPORTS__
})

afterEach(() => {
  delete window.__LSD_REPORT__
  delete window.__LSD_INDEX__
  delete window.__LSD_REPORTS__
  vi.restoreAllMocks()
})

describe('a standalone report Components deep link', () => {
  it('still opens Components from #scenario=&view=components', async () => {
    window.__LSD_REPORT__ = shopReport()
    window.location.hash = '#scenario=pay&view=components'
    await import('../main')
    await vi.waitFor(() => expect(document.querySelector('.scenario-card')).not.toBeNull())
    expect(shownView()).toBe('components')
    expect(diagramHeading()).toBe('Component diagram')
    expect(window.location.hash).toContain('view=components')
  })
})

describe('an index Components deep link', () => {
  it('opens Components and keeps view=components in the hash', async () => {
    window.__LSD_INDEX__ = manifest
    window.__LSD_REPORTS__ = { shop: { report: shopReport(), payloadsSrc: null } }
    window.location.hash = '#report=shop&scenario=pay&view=components'
    await import('../main')
    await vi.waitFor(() => expect(document.querySelector('.scenario-card')).not.toBeNull())
    expect(shownView()).toBe('components')
    expect(diagramHeading()).toBe('Component diagram')
    expect(componentsPaneHidden()).toBe(false)
    expect(window.location.hash).toBe('#report=shop&scenario=pay&view=components')
  })

  it('stays on Sequence when the scenario has no component messages, and drops view=components', async () => {
    window.__LSD_INDEX__ = manifest
    window.__LSD_REPORTS__ = { shop: { report: shopReport(), payloadsSrc: null } }
    window.location.hash = '#report=shop&scenario=notes&view=components'
    await import('../main')
    await vi.waitFor(() => expect(document.querySelector('#scenario-title')?.textContent).toBe('Notes'))
    expect(shownView()).toBe('sequence')
    expect(diagramHeading()).toBe('Sequence diagram')
    expect(document.querySelector('#main .diagram-pane[data-pane="components"]')).toBeNull()
    expect(window.location.hash).toBe('#report=shop&scenario=notes')
  })

  it('opens Sequence when a scenario is chosen from the index list', async () => {
    window.__LSD_INDEX__ = manifest
    window.__LSD_REPORTS__ = {
      shop: { report: shopReport(), payloadsSrc: null },
      cart: {
        report: {
          ...shopReport(),
          title: 'Cart',
          scenarios: [{ ...shopReport().scenarios[0], id: 'c1', title: 'Cart scenario' }],
        },
        payloadsSrc: null,
      },
    }
    window.location.hash = '#report=shop&scenario=pay&view=components'
    const { openReport } = await import('./nav')
    await import('../main')
    await vi.waitFor(() => expect(document.querySelector('#scenario-title')?.textContent).toBe('Pay'))
    expect(shownView()).toBe('components')
    await openReport('cart', { reportId: 'cart', scenarioId: 'c1' })
    expect(document.querySelector('#main h1')?.textContent?.trim()).toBe('Cart')
    expect(shownView()).toBe('sequence')
    expect(diagramHeading()).toBe('Sequence diagram')
  })

  it('opens Sequence when the same URL also names a message', async () => {
    window.__LSD_INDEX__ = manifest
    window.__LSD_REPORTS__ = { shop: { report: shopReport(), payloadsSrc: null } }
    window.location.hash = '#report=shop&msg=pay/m1'
    await import('../main')
    await vi.waitFor(() => expect(document.querySelector('.scenario-card')).not.toBeNull())
    expect(shownView()).toBe('sequence')
    expect(diagramHeading()).toBe('Sequence diagram')
  })
})
