// Usage ping (#31): one tiny jsDelivr request per event per page load, so jsDelivr's public hit
// count for lsd-consulting/lsd-mono shows how the report is used. The report never depends on it:
// the request is not awaited, its failure is ignored, and nothing renders differently either way.

import { VIEWER_VERSION } from './viewer-version'

/** Every event the report can count. Each has a one-byte file, `ping/<event>.txt`, at the repository root. */
export const USAGE_EVENTS = [
  'report-open',
  'metrics-open',
  'components-open',
  'source-junit',
  'source-cucumber',
  'source-api',
] as const

export type UsageEvent = (typeof USAGE_EVENTS)[number]

/** Which integration wrote the report: the report options' `source`. */
export const REPORT_SOURCES = ['junit', 'cucumber', 'api'] as const

export type ReportSource = (typeof REPORT_SOURCES)[number]

const CDN = 'https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono'

/**
 * [version] when it is a release (`0.2.0`); null for a snapshot, dev or unknown build. The page's own
 * version (viewer-version.ts), not the report's `generator`: the page is the same whatever wrote the data.
 */
export function releaseVersion(version: string | undefined): string | null {
  return /^\d+\.\d+\.\d+$/.test(version ?? '') ? version! : null
}

/** The file requested for [event]: pinned to the version, so jsDelivr counts hits per release. No query string. */
export function usagePingUrl(version: string, event: UsageEvent): string {
  return `${CDN}@${version}/ping/${event}.txt`
}

/** The event naming the integration that wrote a report, or null when the source is missing or unknown. */
export function sourceEvent(source: unknown): UsageEvent | null {
  return (REPORT_SOURCES as readonly unknown[]).includes(source) ? (`source-${source as ReportSource}` as const) : null
}

/**
 * What decides whether a page pings, with the page's own version: the report's (or index's) `usagePing`
 * option. A report as normaliseReport gives it, or an index manifest, which always has its options.
 */
export interface UsagePingSource {
  options: { usagePing: boolean }
}

/** Sends one request. Returns a promise when it is asynchronous; any rejection is ignored. */
export type Send = (url: string) => PromiseLike<unknown> | void

/** A request that sends nothing but itself: no cookies, no referrer, and a response the page never reads. */
export const sendPing: Send = (url) =>
  fetch(url, { mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'default' })

export class UsagePing {
  private version: string | null = null
  private readonly sent = new Set<UsageEvent>()

  /** [devBuild] true (the Vite dev server, check:ux, unit tests) never pings; nor does a [viewerVersion] that is not a release. */
  constructor(
    private readonly devBuild: boolean,
    private readonly send: Send = sendPing,
    private readonly viewerVersion: string = VIEWER_VERSION,
  ) {}

  /**
   * Turn pinging on for a report with `usagePing` true, on a page from a release build. Anything
   * else (the option false or missing, a snapshot, dev or unknown page version) turns it off.
   */
  configure(source: UsagePingSource | null | undefined): void {
    this.version = !this.devBuild && source?.options.usagePing === true ? releaseVersion(this.viewerVersion) : null
  }

  /** Whether [ping] would send anything at all. */
  get enabled(): boolean {
    return this.version !== null
  }

  /** Request [event]'s file once per page load. Never throws, never awaited. */
  ping(event: UsageEvent): void {
    if (this.version === null || this.sent.has(event)) return
    this.sent.add(event)
    try {
      const pending = this.send(usagePingUrl(this.version, event))
      pending?.then(undefined, () => {})
    } catch {
      // No fetch, or it threw: the count is best effort.
    }
  }
}

/**
 * The Vite dev server pings only when a check asks for it with `?lsd-usage-ping-check` (see
 * checks/usage-ping.spec.ts). The production bundle drops this, as `import.meta.env.DEV` is false there.
 */
function devCheckOptIn(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('lsd-usage-ping-check')
}

/** The page's pinger. Configured by main.ts once the report or index is known. */
export const usage = new UsagePing(import.meta.env.DEV && !devCheckOptIn())

/** Count the integration that wrote [report], when the report itself allows the ping. */
export function pingSource(
  report: UsagePingSource & { options: { source?: string } },
  pinger: UsagePing = usage,
): void {
  if (!report.options.usagePing) return
  const event = sourceEvent(report.options.source)
  if (event) pinger.ping(event)
}
