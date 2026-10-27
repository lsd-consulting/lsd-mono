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

type UsagePingSourceLike = Parameters<UsagePing['configure']>[0]

const release = { options: { usagePing: true } }

function pinger(send = vi.fn<(url: string) => void>(), version = '0.2.0') {
  const p = new UsagePing(false, send, version)
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

  it('takes only a release version of the page', () => {
    expect(releaseVersion('0.2.0')).toBe('0.2.0')
    expect(releaseVersion('12.3.45')).toBe('12.3.45')
    expect(releaseVersion('0.2.1-SNAPSHOT')).toBeNull()
    expect(releaseVersion('dev')).toBeNull()
    expect(releaseVersion('unknown')).toBeNull()
    expect(releaseVersion('lsd-mono-jvm 0.2.0')).toBeNull()
    expect(releaseVersion('')).toBeNull()
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
    ['usagePing false', { options: { usagePing: false } }, '0.2.0'],
    ['a report that names no options, as the page holds it', { options: DEFAULT_OPTIONS }, '0.2.0'],
    ['a page from a snapshot build', release, '0.2.1-SNAPSHOT'],
    ['a page from a dev build', release, 'dev'],
    ['no report', null, '0.2.0'],
  ])('sends nothing for %s', (_, source, version) => {
    const { p, send } = pinger(undefined, version)
    p.configure(source)
    expect(p.enabled).toBe(false)
    for (const event of USAGE_EVENTS) p.ping(event)
    expect(send).not.toHaveBeenCalled()
  })

  it('pings with the page version whatever wrote the report', () => {
    const { p, send } = pinger(undefined, '0.15.0')
    p.configure({ generator: 'some-other-writer 9.9.9', options: { usagePing: true } } as UsagePingSourceLike)
    p.ping('report-open')
    expect(send.mock.calls.map(([url]) => url)).toEqual([
      'https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@0.15.0/ping/report-open.txt',
    ])
  })

  it('sends nothing from a dev build, even for a release report', () => {
    const send = vi.fn()
    const p = new UsagePing(true, send, '0.2.0')
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
    const throwing = new UsagePing(
      false,
      () => {
        throw new TypeError('fetch is not defined')
      },
      '0.2.0',
    )
    throwing.configure(release)
    expect(() => throwing.ping('report-open')).not.toThrow()

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const send = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
      const p = new UsagePing(false, send, '0.2.0')
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
