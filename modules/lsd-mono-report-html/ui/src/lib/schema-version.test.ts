import { describe, expect, it } from 'vitest'
import { REPORT_SCHEMA_VERSION } from '../types'
import { newerMinorNoticeHtml, schemaFit, unreadableFit, upgradeHtml } from './schema-version'

describe('schemaFit', () => {
  it('reads its own version, older ones, a newer patch, and a report from before the schema', () => {
    for (const version of ['0.1.0', '0.0.9', '0.1.7', undefined, null]) {
      expect(schemaFit(version, '0.1.0'), String(version)).toEqual({ kind: 'readable' })
    }
    expect(schemaFit('0.3.0', '1.2.0')).toEqual({ kind: 'readable' })
  })

  it('reads a newer minor version, which only adds', () => {
    expect(schemaFit('0.2.0', '0.1.0')).toEqual({ kind: 'newer-minor', version: '0.2.0' })
    expect(schemaFit('1.10.0', '1.9.3')).toEqual({ kind: 'newer-minor', version: '1.10.0' })
  })

  it('does not read a newer major version, or a version that is not one', () => {
    expect(schemaFit('1.0.0', '0.1.0')).toEqual({ kind: 'newer-major', version: '1.0.0' })
    expect(schemaFit('2.0.0', '1.4.0')).toEqual({ kind: 'newer-major', version: '2.0.0' })
    expect(schemaFit('v2', '0.1.0')).toEqual({ kind: 'not-a-version', version: 'v2' })
    expect(schemaFit('0.1', '0.1.0')).toEqual({ kind: 'not-a-version', version: '0.1' })
    expect(schemaFit(2, '0.1.0')).toEqual({ kind: 'not-a-version', version: '2' })
  })

  it('reads every 0.x report, and a 1.x one of its minor or older, as a 1.0 page', () => {
    for (const version of ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '1.0.0', '1.0.5']) {
      expect(schemaFit(version, '1.0.0'), version).toEqual({ kind: 'readable' })
    }
    expect(schemaFit('1.1.0', '1.0.0')).toEqual({ kind: 'newer-minor', version: '1.1.0' })
    expect(schemaFit('2.0.0', '1.0.0')).toEqual({ kind: 'newer-major', version: '2.0.0' })
  })

  it('is a 1.x page, so the 0.x reports and indexes still open', () => {
    expect(REPORT_SCHEMA_VERSION.split('.')[0]).toBe('1')
    expect(schemaFit('0.3.0')).toEqual({ kind: 'readable' })
    expect(schemaFit('0.1.0')).toEqual({ kind: 'readable' })
    expect(unreadableFit({ schemaVersion: '0.3.0' })).toBeNull()
  })

  it('compares with the version the UI was generated from by default', () => {
    expect(schemaFit(REPORT_SCHEMA_VERSION)).toEqual({ kind: 'readable' })
    expect(unreadableFit({ schemaVersion: '99.0.0' })).toEqual({ kind: 'newer-major', version: '99.0.0' })
    expect(unreadableFit({ schemaVersion: 'v2' })).toEqual({ kind: 'not-a-version', version: 'v2' })
    expect(unreadableFit({ schemaVersion: REPORT_SCHEMA_VERSION })).toBeNull()
    expect(unreadableFit(null)).toBeNull()
  })
})

describe('the version notices', () => {
  it('notes a newer minor version only', () => {
    const [major, minor] = REPORT_SCHEMA_VERSION.split('.').map(Number)
    const newer = `${major}.${minor + 1}.0`
    expect(newerMinorNoticeHtml(newer)).toContain(`report format ${newer}; this page reads ${REPORT_SCHEMA_VERSION}`)
    expect(newerMinorNoticeHtml(newer, 'index')).toContain('This index was written by a newer lsd-mono')
    expect(newerMinorNoticeHtml(REPORT_SCHEMA_VERSION)).toBe('')
    expect(newerMinorNoticeHtml(`${major + 1}.0.0`)).toBe('')
  })

  it('says to upgrade, and shows the version as text', () => {
    const html = upgradeHtml({ kind: 'newer-major', version: '<b>9</b>' }, 'report', 'h2')
    expect(html).toContain('<h2 id="schema-upgrade-title">Upgrade lsd-mono to open this report</h2>')
    expect(html).toContain('report format &lt;b&gt;9&lt;/b&gt;')
    expect(html).toContain('a new major version may change anything')
  })

  it('says a version that is not one is not, without blaming a new major', () => {
    const html = upgradeHtml({ kind: 'not-a-version', version: '<i>v2</i>' }, 'index')
    expect(html).toContain('<h1 id="schema-upgrade-title">This index cannot be opened</h1>')
    expect(html).toContain('Its report format, &lt;i&gt;v2&lt;/i&gt;, is not a version number')
    expect(html).not.toContain('new major version')
  })

  it('is a labelled region, not an alert', () => {
    for (const kind of ['newer-major', 'not-a-version'] as const) {
      const html = upgradeHtml({ kind, version: '9.0.0' }, 'report')
      expect(html).not.toContain('role="alert"')
      expect(html).toContain('<section class="schema-upgrade" aria-labelledby="schema-upgrade-title">')
    }
  })
})
