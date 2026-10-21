import type { DiagramEvent, MessageEvent, Report, Scenario } from '../types'
import { cssEscape, jsonForScript, wellFormedJson } from './escape.ts'

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
function splitReportPayloads(report: Report): SplitReport {
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
  if (!defer) return { summary: data, defer: false }
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
  /**
   * Sibling classic script, or null when every payload already fits on the message. It assigns
   * `__LSD_PAYLOAD_TEXT__`: each payload as its JSON text, parsed only when it is read (#63).
   */
  payloadsJs: string | null
}

/** What the report writer injects. `payloadsSrc` is the sibling file name, same directory as the HTML. */
export function shellParts(report: Report, payloadsSrc: string): ShellParts {
  const split = splitReportPayloads(report)
  const reportJson = jsonForScript(split.report)
  const hasPayloads = Object.keys(split.payloads).length > 0
  const srcAssign = hasPayloads ? `window.__LSD_PAYLOADS_SRC__=${jsonForScript(payloadsSrc)};` : ''
  return {
    report: split.report,
    payloads: split.payloads,
    htmlScript: `<script>${srcAssign}window.__LSD_REPORT__=${reportJson};</script>\n`,
    payloadsJs: hasPayloads ? payloadTextScript(split.payloads) : null,
  }
}

/**
 * The payload script: each payload as JSON text, so loading it parses strings, not every body.
 * Lone surrogates become U+FFFD, as the Kotlin writer (`shellPayloadScript`) writes them.
 */
export function payloadTextScript(payloads: Record<string, unknown>): string {
  const text = Object.fromEntries(Object.entries(payloads).map(([key, value]) => [key, wellFormedJson(value)]))
  return `window.__LSD_PAYLOAD_TEXT__=${jsonForScript(text)};\n`
}

/**
 * Payloads by key from JSON [text]: each is parsed the first time it is read, then kept, and its
 * text is dropped. A 100-participant, 2,000-message report no longer parses 5.6 MB of bodies to
 * open one. Text that is not JSON is shown as it is, with one console warning per script.
 */
export function lazyPayloads(text: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let warned = false
  const parse = (key: string): unknown => {
    const raw = text[key]
    try {
      return JSON.parse(raw) as unknown
    } catch {
      if (!warned) {
        warned = true
        console.warn(`LSD report: payload ${key} is not valid JSON; showing its text as it is.`)
      }
      return raw
    }
  }
  for (const key of Object.keys(text)) {
    Object.defineProperty(out, key, {
      enumerable: true,
      configurable: true,
      get() {
        const value = parse(key)
        Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })
        delete text[key]
        return value
      },
    })
  }
  return out
}

/**
 * What a payload script left: `__LSD_PAYLOAD_TEXT__` from this version's writer, or
 * `__LSD_PAYLOADS__` from an older one (an index page can list reports from both).
 */
function takenPayloads(): Record<string, unknown> | undefined {
  if (window.__LSD_PAYLOAD_TEXT__) {
    window.__LSD_PAYLOADS__ = lazyPayloads(window.__LSD_PAYLOAD_TEXT__)
    window.__LSD_PAYLOAD_TEXT__ = undefined
  }
  return window.__LSD_PAYLOADS__
}

let payloadsPromise: Promise<Record<string, unknown>> | null = null

/** Payloads by script, for the index page, where several reports load their own. */
const payloadsBySrc = new Map<string, Promise<Record<string, unknown>>>()
/** Payload scripts all assign `__LSD_PAYLOADS__`, so they load one at a time. */
let payloadQueue: Promise<unknown> = Promise.resolve()

/**
 * Bodies from one report's payload script (`<stem>-payloads.js`), on the index page.
 * Each script assigns the same global, so loads are queued and each result is kept
 * under its script name before the next one runs.
 */
export function loadPayloadsFrom(src: string): Promise<Record<string, unknown>> {
  let pending = payloadsBySrc.get(src)
  if (!pending) {
    pending = payloadQueue.then(async () => {
      const before = window.__LSD_PAYLOADS__
      window.__LSD_PAYLOADS__ = undefined
      window.__LSD_PAYLOAD_TEXT__ = undefined
      try {
        await injectPayloadScript(src)
        return takenPayloads() ?? {}
      } finally {
        window.__LSD_PAYLOADS__ = before
        window.__LSD_PAYLOAD_TEXT__ = undefined
      }
    })
    pending.catch(() => payloadsBySrc.delete(src))
    payloadsBySrc.set(src, pending)
    payloadQueue = pending.catch(() => undefined)
  }
  return pending
}

/** Test hook. The report page loads once. */
export function resetPayloadCache(): void {
  payloadsPromise = null
  payloadsBySrc.clear()
  payloadQueue = Promise.resolve()
}

/**
 * Bodies for the open inspector. A captured report points at a sibling script
 * (`__LSD_PAYLOADS_SRC__`). The demo loads its module on first open so the
 * sample bodies are not in the first script.
 */
export function loadExternalPayloads(useSample: boolean): Promise<Record<string, unknown>> {
  const onPage = typeof window !== 'undefined' ? takenPayloads() : undefined
  if (onPage) return Promise.resolve(onPage)
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
    return takenPayloads() ?? {}
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
    return takenPayloads() ?? {}
  }
  return {}
}

function injectPayloadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const selector = `script[data-lsd-payloads="${cssEscape(src)}"]`
    if (document.querySelector(selector)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = false
    script.setAttribute('data-lsd-payloads', src)
    script.onload = () => resolve()
    script.onerror = () => {
      // Gone, so opening a message again tries the file again.
      script.remove()
      reject(new Error(`Could not load payloads from ${src}`))
    }
    document.head.appendChild(script)
  })
}
