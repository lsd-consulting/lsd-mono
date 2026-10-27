import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPTIONS } from './report-normalise'
import {
  REPORT_SOURCES,
  USAGE_EVENTS,
  UsagePing,
  pingSource,
  releaseVersion,
  sendPing,
  sourceEvent,
  usage,
  usagePingUrl,
} from './usage-ping'

const release = { generator: 'lsd-mono-jvm 0.2.0', options: { usagePing: true } }

function pinger(send = vi.fn<(url: string) => void>()) {
  const p = new UsagePing(false, send)
  return { p, send }
}

describe('usage ping', () => {
  it('has a committed one-byte file for every event, so a tagged release serves them all', () => {
    for (const event of USAGE_EVENTS) {
      const file = new URL(`../../../../../ping/${event}.txt`, import.meta.url)
      expect(existsSync(file), `ping/${event}.txt`).toBe(true)
      expect(readFileSync(file).length, `ping/${event}.txt`).toBe(1)
    }
  })

  it('has an event for every report source', () => {
    for (const source of REPORT_SOURCES) expect(USAGE_EVENTS).toContain(sourceEvent(source))
    expect(sourceEvent('testng')).toBeNull()
    expect(sourceEvent(undefined)).toBeNull()
  })

  it('takes the version only from a release generator', () => {
    expect(releaseVersion('lsd-mono-jvm 0.2.0')).toBe('0.2.0')
    expect(releaseVersion('lsd-mono-jvm 12.3.45')).toBe('12.3.45')
    expect(releaseVersion('lsd-mono-jvm 0.2.1-SNAPSHOT')).toBeNull()
    expect(releaseVersion('lsd-mono-jvm unknown')).toBeNull()
    expect(releaseVersion('lsd-mono-core 0.2.0')).toBe('0.2.0')
    expect(releaseVersion('lsd-mono-core 0.2.1-SNAPSHOT')).toBeNull()
    expect(releaseVersion('ux-fixture')).toBeNull()
    expect(releaseVersion(undefined)).toBeNull()
  })

  it('requests the version-pinned file for the event, with no query string', () => {
    expect(usagePingUrl('0.2.0', 'report-open')).toBe(
      'https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@0.2.0/ping/report-open.txt',
    )
  })

  it('sends each event at most once per page load', () => {
    const { p, send } = pinger()
    p.configure(release)
    p.ping('report-open')
    p.ping('metrics-open')
    p.ping('metrics-open')
    p.ping('report-open')
    expect(send.mock.calls.map(([url]) => url)).toEqual([
      'https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@0.2.0/ping/report-open.txt',
      'https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@0.2.0/ping/metrics-open.txt',
    ])
  })

  it.each([
    ['usagePing false', { generator: 'lsd-mono-jvm 0.2.0', options: { usagePing: false } }],
    [
      'a report that names no options, as the page holds it',
      { generator: 'lsd-mono-jvm 0.2.0', options: DEFAULT_OPTIONS },
    ],
    ['a snapshot build', { generator: 'lsd-mono-jvm 0.2.1-SNAPSHOT', options: { usagePing: true } }],
    ['an unknown version', { generator: 'lsd-mono-jvm unknown', options: { usagePing: true } }],
    ['no report', null],
  ])('sends nothing for %s', (_, source) => {
    const { p, send } = pinger()
    p.configure(source)
    expect(p.enabled).toBe(false)
    for (const event of USAGE_EVENTS) p.ping(event)
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing from a dev build, even for a release report', () => {
    const send = vi.fn()
    const p = new UsagePing(true, send)
    p.configure(release)
    p.ping('report-open')
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing before it is configured', () => {
    const { p, send } = pinger()
    p.ping('report-open')
    expect(send).not.toHaveBeenCalled()
  })

  it('ignores a request that throws or fails, and does not retry it', async () => {
    const throwing = new UsagePing(false, () => {
      throw new TypeError('fetch is not defined')
    })
    throwing.configure(release)
    expect(() => throwing.ping('report-open')).not.toThrow()

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const send = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
      const p = new UsagePing(false, send)
      p.configure(release)
      p.ping('report-open')
      p.ping('report-open')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(send).toHaveBeenCalledTimes(1)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('fetches without cookies, referrer or a readable response', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null)))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await sendPing('https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@0.2.0/ping/report-open.txt')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@0.2.0/ping/report-open.txt',
        { mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'default' },
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('is off on the page pinger in tests, which run as a dev build', () => {
    usage.configure(release)
    expect(usage.enabled).toBe(false)
  })

  it('counts the integration that wrote a report only when the report allows the ping', () => {
    const { p, send } = pinger()
    p.configure(release)
    pingSource({ ...release, options: { usagePing: false, source: 'junit' } }, p)
    pingSource({ ...release, options: { usagePing: true, source: 'testng' } }, p)
    pingSource({ ...release, options: { usagePing: true } }, p)
    expect(send).not.toHaveBeenCalled()
    pingSource({ ...release, options: { usagePing: true, source: 'cucumber' } }, p)
    pingSource({ ...release, options: { usagePing: true, source: 'cucumber' } }, p)
    pingSource({ ...release, options: { usagePing: true, source: 'junit' } }, p)
    expect(send.mock.calls.map(([url]) => url.split('/').pop())).toEqual(['source-cucumber.txt', 'source-junit.txt'])
  })
})
