import type { DiagramEvent, MessageEvent, Report, Scenario } from '../types'

/** Keys kept on the message for the first paint. Everything else waits for the inspector. */
const SUMMARY_KEYS = new Set(['method', 'path', 'status'])

export function payloadKey(scenarioId: string, messageId: string): string {
  return `${scenarioId}/${messageId}`
}

export interface SplitReport {
  report: Report
  /** Full payloads, keyed by `scenarioId/messageId`. Not part of the report document. */
  payloads: Record<string, unknown>
}

/**
 * Copy a report so the injected document keeps method, path, and status only.
 * Any other payload field is moved to `payloads` and referenced by `payloadId`.
 * Messages with no payload are unchanged. A payload that is only those three
 * fields stays on the message, because there is nothing further to load.
 */
export function splitReportPayloads(report: Report): SplitReport {
  const payloads: Record<string, unknown> = {}
  const scenarios = report.scenarios.map((scenario) => splitScenario(scenario, payloads))
  return { report: { ...report, scenarios }, payloads }
}

function splitScenario(scenario: Scenario, payloads: Record<string, unknown>): Scenario {
  const events: DiagramEvent[] = scenario.events.map((event) => {
    if (event.kind !== 'message') return event
    return splitMessage(scenario.id, event, payloads)
  })
  return { ...scenario, events }
}

function splitMessage(scenarioId: string, message: MessageEvent, payloads: Record<string, unknown>): MessageEvent {
  if (message.data === undefined || message.data === null) return message
  const id = payloadKey(scenarioId, message.id)
  const split = splitMessageData(message.data)
  if (!split.defer) return message
  payloads[id] = message.data
  const next: MessageEvent = { ...message, payloadId: id }
  if (split.summary === undefined) delete next.data
  else next.data = split.summary
  return next
}

function splitMessageData(data: unknown): { summary?: Record<string, unknown>; defer: boolean } {
  if (!isRecord(data)) return { defer: true }
  const summary: Record<string, unknown> = {}
  let defer = false
  for (const [key, value] of Object.entries(data)) {
    if (isSummaryField(key, value)) summary[key] = value
    else defer = true
  }
  if (!defer) return { summary: data as Record<string, unknown>, defer: false }
  return { summary: Object.keys(summary).length ? summary : undefined, defer: true }
}

function isSummaryField(key: string, value: unknown): boolean {
  if (!SUMMARY_KEYS.has(key)) return false
  if (key === 'status') return (typeof value === 'string' && value !== '') || typeof value === 'number'
  return typeof value === 'string' && value !== ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ShellParts {
  report: Report
  payloads: Record<string, unknown>
  /** Script element inserted before the shell. Does not contain deferred bodies. */
  htmlScript: string
  /** Sibling classic script, or null when every payload already fits on the message. */
  payloadsJs: string | null
}

/** What the report writer injects. `payloadsSrc` is the sibling file name, same directory as the HTML. */
export function shellParts(report: Report, payloadsSrc: string): ShellParts {
  const split = splitReportPayloads(report)
  const reportJson = encodeScriptJson(split.report)
  const hasPayloads = Object.keys(split.payloads).length > 0
  const srcAssign = hasPayloads ? `window.__LSD_PAYLOADS_SRC__=${JSON.stringify(payloadsSrc)};` : ''
  return {
    report: split.report,
    payloads: split.payloads,
    htmlScript: `<script>${srcAssign}window.__LSD_REPORT__=${reportJson};</script>\n`,
    payloadsJs: hasPayloads ? `window.__LSD_PAYLOADS__=${encodeScriptJson(split.payloads)};\n` : null,
  }
}

function encodeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

let payloadsPromise: Promise<Record<string, unknown>> | null = null

/** Test hook. The report page loads once. */
export function resetPayloadCache(): void {
  payloadsPromise = null
}

/**
 * Bodies for the open inspector. A captured report points at a sibling script
 * (`__LSD_PAYLOADS_SRC__`). The demo loads its module on first open so the
 * sample bodies are not in the first script.
 */
export function loadExternalPayloads(useSample: boolean): Promise<Record<string, unknown>> {
  if (typeof window !== 'undefined' && window.__LSD_PAYLOADS__) return Promise.resolve(window.__LSD_PAYLOADS__)
  if (!payloadsPromise) {
    payloadsPromise = fetchPayloads(useSample).catch((error: unknown) => {
      payloadsPromise = null
      throw error
    })
  }
  return payloadsPromise
}

const SAMPLE_PAYLOAD_SRC = 'lsd-report-payloads.js'

async function fetchPayloads(useSample: boolean): Promise<Record<string, unknown>> {
  if (typeof window !== 'undefined' && window.__LSD_PAYLOADS_SRC__) {
    await injectPayloadScript(window.__LSD_PAYLOADS_SRC__)
    return window.__LSD_PAYLOADS__ ?? {}
  }
  if (useSample) {
    // Dev server can import the module. The packaged shell is a classic script, so production
    // loads the sibling file written next to the HTML. The DEV check is replaced at build time
    // and the import is dropped from the single-file bundle.
    if (import.meta.env.DEV) {
      const mod = await import('../data/sample-payloads')
      return mod.samplePayloads
    }
    await injectPayloadScript(SAMPLE_PAYLOAD_SRC)
    return window.__LSD_PAYLOADS__ ?? {}
  }
  return {}
}

function injectPayloadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const selector = `script[data-lsd-payloads="${src.replace(/"/g, '\\"')}"]`
    if (document.querySelector(selector)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = false
    script.setAttribute('data-lsd-payloads', src)
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Could not load payloads from ${src}`))
    document.head.appendChild(script)
  })
}
