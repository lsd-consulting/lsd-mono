// @vitest-environment happy-dom
// The shared test reports (modules/lsd-mono-report-schema/conformance) from the report UI's side:
// the schema accepts and rejects what the manifest says, and the whole page boots on every report
// the schema accepts and on each the manifest gives a `page`, showing each scenario in both views
// and the Metrics panel, with no error and no markup made from report text; on a report of a newer
// major version the upgrade page, and on one whose version is not one the cannot-open page. The
// index page boots on every index manifest and opens its report.
// lsd-mono-jvm's ConformanceTest checks the producer's side.
import { readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFORMANCE, fixtureData, fixtures, type Fixture } from './lib/conformance.test-util'
import { schemaErrors } from './lib/report-schema.test-util'
import { schemaFit } from './lib/schema-version'
import type { IndexManifest } from './lib/report-index'
import type { Report } from './types'

/** [data]'s errors against the fixture's schema, as instance paths. */
function rejected(fixture: Fixture, data: unknown): string[] {
  return schemaErrors(data, fixture.schema === 'lsd-index.schema.json' ? 'index' : 'report').map((e) =>
    e.slice(0, e.indexOf(': ')),
  )
}

const checked = fixtures.filter((f) => f.schema)
const fit = (fixture: Fixture) => schemaFit((fixtureData(fixture) as { schemaVersion?: unknown }).schemaVersion)
/** What the page shows for [fixture]: its manifest's `page`, or the report for a valid one. */
const pageOf = (fixture: Fixture) => fixture.page ?? 'report'
/** Every report the page boots on: the valid ones, and the others the manifest gives a page. */
const booted = fixtures.filter((f) => f.schema === 'lsd-report.schema.json' && (f.valid || f.page))
const pages = booted.filter((f) => pageOf(f) === 'report')
const unreadable = booted.filter((f) => pageOf(f) !== 'report')
const indexes = fixtures.filter((f) => f.schema === 'lsd-index.schema.json' && f.valid)
const HEADINGS = { upgrade: 'Upgrade lsd-mono to open this report', 'cannot-open': 'This report cannot be opened' }

describe('the shared test reports', () => {
  it('are all in the manifest, and the manifest names no missing file', () => {
    const files = (readdirSync(CONFORMANCE, { recursive: true }) as string[])
      .map((file) => file.split('\\').join('/'))
      .filter((file) => /\.(json|mjs|js)$/.test(file) && file !== 'manifest.json')
    expect(files.sort()).toEqual(fixtures.map((f) => f.file).sort())
  })

  it.each(checked.filter((f) => f.valid).map((f) => [f.file, f] as const))('the schema accepts %s', (_, fixture) => {
    expect(rejected(fixture, fixtureData(fixture))).toEqual([])
  })

  it.each(checked.filter((f) => !f.valid).map((f) => [f.file, f] as const))(
    'the schema rejects %s where the manifest says',
    (_, fixture) => {
      expect(rejected(fixture, fixtureData(fixture))).toContain(fixture.rejectedAt)
    },
  )
})

/** Elements and attributes report text must never become. */
function injected(root: ParentNode): string[] {
  const found: string[] = []
  root.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'img' || tag === 'script' || tag === 'iframe') found.push(`<${tag}>`)
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on') || attr.name === 'data-pwned' || attr.name === 'src')
        found.push(`${tag}[${attr.name}]`)
    }
  })
  return found
}

describe('the page on each shared report', () => {
  let errors: unknown[]
  const onError = (event: Event) => errors.push((event as ErrorEvent).error ?? event)
  beforeEach(() => {
    errors = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => errors.push(args))
    window.addEventListener('error', onError)
  })
  afterEach(() => {
    window.removeEventListener('error', onError)
    vi.restoreAllMocks()
  })

  async function boot(fixture: Fixture): Promise<void> {
    vi.resetModules()
    document.body.innerHTML = '<div id="app"></div>'
    window.location.hash = ''
    window.__LSD_REPORT__ = fixtureData(fixture) as Report
    await import('./main')
  }

  it('include a newer major and minor version, a version that is not one, and a report from before versions', () => {
    expect(unreadable.map((f) => [f.file, pageOf(f)])).toEqual([
      ['reports/next-major.json', 'upgrade'],
      ['invalid/malformed-version.json', 'cannot-open'],
    ])
    expect(pages.filter((f) => fit(f).kind === 'newer-minor').map((f) => f.file)).toEqual(['reports/future-minor.json'])
    expect(pages.filter((f) => !f.valid).map((f) => f.file)).toEqual([
      'invalid/missing-schema-version.json',
      'invalid/legacy-report.json',
    ])
  })

  it.each(booted.map((f) => [f.file, f] as const))('the manifest says what the page shows for %s', (_, fixture) => {
    const expected = {
      readable: 'report',
      'newer-minor': 'report',
      'newer-major': 'upgrade',
      'not-a-version': 'cannot-open',
    }
    expect(pageOf(fixture)).toBe(expected[fit(fixture).kind])
  })

  it.each(pages.map((f) => [f.file, f] as const))('shows every scenario of %s', async (_, fixture) => {
    await boot(fixture)
    const { session } = await import('./app/context')
    const { applyRef } = await import('./app/routing')
    // As the page holds it: normalised, so events of unknown kinds are gone.
    const report = session.report

    expect(document.querySelector('#scenario-title')?.textContent).toBe(report.scenarios[0].title)
    expect(document.querySelector('.schema-notice') !== null, 'a notice').toBe(fit(fixture).kind === 'newer-minor')
    for (const scenario of report.scenarios) {
      for (const view of [undefined, 'components'] as const) {
        applyRef({ scenarioId: scenario.id, view })
        expect(document.querySelector('#scenario-title')?.textContent, scenario.id).toBe(scenario.title)
      }
      if (scenario.participants.length > 0) {
        applyRef({ scenarioId: scenario.id })
        expect(document.querySelectorAll('.seq-svg .msg-label, .seq-svg text').length, scenario.id).toBeGreaterThan(0)
      }
      document.querySelector<HTMLButtonElement>('[data-show-metrics]')?.click()
    }
    expect(injected(document.body)).toEqual([])
    expect(errors).toEqual([])
  })

  it.each(unreadable.map((f) => [f.file, f] as const))('shows only the version page for %s', async (_, fixture) => {
    await boot(fixture)
    expect(document.querySelector('h1')?.textContent).toBe(HEADINGS[pageOf(fixture) as keyof typeof HEADINGS])
    expect(document.querySelector('.scenario-card')).toBeNull()
    expect(errors).toEqual([])
  })

  it('include an index manifest', () => {
    expect(indexes.map((f) => f.file)).toEqual(['indexes/status-mix.json'])
  })

  // Each index entry's data is the shared report of the same title (status-mix is the index
  // lsd-mono-jvm writes for multi-scenario-status).
  it.each(indexes.map((f) => [f.file, f] as const))(
    'boots the index page on %s and opens its reports',
    async (_, fixture) => {
      vi.resetModules()
      document.body.innerHTML = '<div id="app"></div>'
      window.location.hash = ''
      // The report pages' boots leave their report behind, and a page with one is not an index page.
      delete window.__LSD_REPORT__
      const manifest = fixtureData(fixture) as IndexManifest
      const byTitle = new Map(pages.map((f) => [(fixtureData(f) as Report).title, fixtureData(f) as Report]))
      window.__LSD_INDEX__ = manifest
      window.__LSD_REPORTS__ = Object.fromEntries(
        manifest.reports.map((entry) => [entry.id, { report: byTitle.get(entry.title)!, payloadsSrc: null }]),
      )
      const { openReport } = await import('./app/nav')
      await import('./main')
      for (const entry of manifest.reports) {
        expect(byTitle.has(entry.title), `a shared report titled ${entry.title}`).toBe(true)
        await openReport(entry.id)
        expect(document.querySelector('.report-hero')?.querySelector('h1')?.textContent).toBe(entry.title)
        expect(entry.scenarios.map((sc) => sc.title)).toContain(document.querySelector('#scenario-title')?.textContent)
        const nav = document.querySelector('#scenario-nav')?.textContent ?? ''
        for (const scenario of entry.scenarios) expect(nav, scenario.id).toContain(scenario.title)
      }
      expect(injected(document.body)).toEqual([])
      expect(errors).toEqual([])
      delete window.__LSD_INDEX__
      delete window.__LSD_REPORTS__
    },
  )
})
