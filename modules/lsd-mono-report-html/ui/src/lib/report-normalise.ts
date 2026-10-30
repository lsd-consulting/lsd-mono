// Where a report as a producer wrote it becomes the report the UI holds. The schema leaves the
// options, a scenario's timing summary and every empty list out, and a report from before 1.0.0
// (schema 0.x, or no version: an older lsd-mono's `<stem>-report.js` beside a newer index) has
// older shapes. Both are dealt with here, once, when a report is loaded, so the views never apply
// a default of their own or know an old shape. Events of a kind this UI does not know (from a
// newer producer) are dropped, as the schema says.
import type {
  DiagramEvent,
  Generator,
  MessageEvent,
  MessageEventJson,
  Report,
  ReportJson,
  ReportOptions,
  Scenario,
  ScenarioJson,
} from '../types'
import { DEFAULT_LABEL_MAX_CHARS } from '../ui/format'

/** The options a report that names none was written with. No usage ping without a say-so. */
export const DEFAULT_OPTIONS: ReportOptions = {
  metricsEnabled: true,
  labelMaxChars: DEFAULT_LABEL_MAX_CHARS,
  usagePing: false,
}

const KNOWN_KINDS: Record<DiagramEvent['kind'], true> = {
  message: true,
  note: true,
  divider: true,
  section: true,
  delay: true,
  spacer: true,
  activate: true,
  deactivate: true,
}

/** Whether this UI knows [event]'s kind. */
export function isKnownEvent(event: { kind: string }): event is DiagramEvent {
  return Object.hasOwn(KNOWN_KINDS, event.kind)
}

/** Whether [data] is from before schema 1.0.0: no schemaVersion, or major version 0. */
export function isLegacy(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const version = (data as { schemaVersion?: unknown }).schemaVersion
  return version === undefined || version === null || (typeof version === 'string' && version.startsWith('0.'))
}

// What counts as the version in a 0.x generator's text: 0.15.0, v1.2, 0.3.1-SNAPSHOT.
const LEGACY_VERSION = /^v?\d+(\.\d+)*([-+.][0-9A-Za-z.-]+)?$/

/** A generator as 1.0.0 writes it, from a 0.x one's `"name version"` text; without a version when the rest is not one. */
export function legacyGenerator(generator: unknown): Generator {
  if (typeof generator === 'object' && generator !== null && 'name' in generator) return generator as Generator
  const text = typeof generator === 'string' ? generator.trim() : ''
  const space = text.indexOf(' ')
  if (space < 0) return { name: text || 'unknown' }
  const version = text.slice(space + 1).trim()
  // Only a version-shaped rest is a version ("lsd-mono-jvm 0.15.0"); "(conformance)" stays in the name.
  if (!LEGACY_VERSION.test(version)) return { name: text }
  return { name: text.slice(0, space), version }
}

type Json = Record<string, unknown>

// 0.x wrote these fields' values in upper case (STRUCTURE_ONLY); 1.0.0 writes lower snake case.
const LEGACY_ENUM_FIELDS = [
  'type',
  'placement',
  'timing',
  'pairing',
  'order',
  'origin',
  'accuracy',
  'clockOrdering',
  'kind',
  'source',
]
// 0.x field names that 1.0.0 renamed.
const LEGACY_RENAMES: Record<string, string> = {
  alias: 'displayName',
  colour: 'color',
  labelMaxWidth: 'labelMaxChars',
  measuredCoverage: 'measuredRatio',
  pairingCoverage: 'pairedRatio',
  clockOrdered: 'clockOrderedCount',
}

function lower(value: unknown): unknown {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(lower)
  return value
}

/** [item] with 0.x names and upper-case enum values as 1.0.0 writes them. */
function upgradeObject(item: unknown): Json {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return item as Json
  const out: Json = {}
  for (const [key, value] of Object.entries(item as Json)) {
    const name = LEGACY_RENAMES[key] ?? key
    out[name] = LEGACY_ENUM_FIELDS.includes(key) ? lower(value) : value
  }
  return out
}

function upgradeMessage(event: Json): Json {
  const out = upgradeObject(event)
  // 0.x: replyOf was the id of the call a paired reply answers, and replyTo the call's call id.
  // 1.0.0 has one field, replyTo, with the call's message id, and the call id in callId.
  const { replyOf, replyTo } = out
  delete out.replyOf
  delete out.replyTo
  if (replyTo !== undefined && out.callId === undefined) out.callId = replyTo
  if (replyOf !== undefined) out.replyTo = replyOf
  return out
}

/** A 0.x scenario in 1.0.0's shape. */
function upgradeScenario(scenario: Json): Json {
  const out = upgradeObject(scenario)
  if (typeof out.status === 'string') out.status = out.status.toLowerCase()
  if (Array.isArray(out.participants)) out.participants = out.participants.map(upgradeObject)
  if (Array.isArray(out.events)) {
    out.events = out.events.map((e: Json) => (e?.kind === 'message' ? upgradeMessage(e) : upgradeObject(e)))
  }
  if (Array.isArray(out.warnings)) out.warnings = out.warnings.map(upgradeObject)
  if (Array.isArray(out.pairAccuracy)) out.pairAccuracy = out.pairAccuracy.map(upgradeObject)
  return out
}

/** [report] in 1.0.0's shape when it is from before 1.0.0 (see isLegacy); otherwise [report]. */
export function upgradeLegacyReport(report: ReportJson): ReportJson {
  if (!isLegacy(report)) return report
  const raw = report as unknown as Json
  return {
    ...raw,
    generator: legacyGenerator(raw.generator),
    options: raw.options === undefined ? undefined : upgradeObject(raw.options),
    scenarios: Array.isArray(raw.scenarios) ? raw.scenarios.map(upgradeScenario) : raw.scenarios,
  } as unknown as ReportJson
}

// The same report object always gives the same normalised one, and a normalised one is its own.
const normalised = new WeakMap<object, Report>()

/** [report] with its optional fields filled in, and in 1.0.0's shape if older. Leaves [report] as it is. */
export function normaliseReport(report: ReportJson | Report): Report {
  const known = normalised.get(report)
  if (known) return known
  const upgraded = upgradeLegacyReport(report as ReportJson)
  const result: Report = {
    ...upgraded,
    generator: legacyGenerator(upgraded.generator),
    options: { ...DEFAULT_OPTIONS, ...withoutUndefined(upgraded.options ?? {}) },
    scenarios: (upgraded.scenarios ?? []).map(normaliseScenario),
  }
  normalised.set(report, result)
  normalised.set(result, result)
  return result
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

function isNormalMessage(message: MessageEventJson): boolean {
  return message.from !== undefined && message.to !== undefined
}

function normaliseMessage(message: MessageEventJson): MessageEvent {
  return { ...message, from: message.from ?? '', to: message.to ?? '' }
}

/**
 * [scenario] with its lists (empty when absent), description and timing summary: what lsd-mono-jvm
 * would have written for it, as far as the events say. Accuracy is measured when a message has a
 * duration or start time, and structure_only otherwise; the sources are the one local clock when
 * there are messages.
 */
export function normaliseScenario(scenario: ScenarioJson | Scenario): Scenario {
  // The generated type leaves unknown kinds out; a newer producer's report can still have them.
  const written: readonly { kind: string }[] = scenario.events ?? []
  // The list as written when it needs nothing (a normalised scenario's own, say), so it stays the same object.
  const asWritten = written.every(
    (e) => isKnownEvent(e) && (e.kind !== 'message' || isNormalMessage(e as MessageEventJson)),
  )
  const events = asWritten
    ? (written as DiagramEvent[])
    : ((written.filter(isKnownEvent) as (DiagramEvent | MessageEventJson)[]).map((e) =>
        e.kind === 'message' ? normaliseMessage(e) : e,
      ) as DiagramEvent[])
  const messages = events.filter((e) => e.kind === 'message')
  return {
    ...scenario,
    description: scenario.description ?? '',
    facts: scenario.facts ?? [],
    metrics: scenario.metrics ?? [],
    participants: scenario.participants ?? [],
    events,
    accuracy:
      scenario.accuracy ??
      (messages.some((m) => m.durationMs != null || m.startedAt != null) ? 'measured' : 'structure_only'),
    sources: scenario.sources ?? (messages.length > 0 ? ['local'] : []),
    clockOrdering: scenario.clockOrdering ?? 'same_source',
    clockOrderedCount: scenario.clockOrderedCount ?? 0,
  }
}
