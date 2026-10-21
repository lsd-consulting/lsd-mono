// Where a report as a producer wrote it becomes the report the UI holds. The schema leaves the
// options and a scenario's timing summary optional, and a report from before the schema (an
// older lsd-mono's `<stem>-report.js` beside a newer index) can lack them too: the defaults are
// filled in here, once, when a report is loaded, so the views never apply their own. Events of
// a kind this UI does not know (from a newer producer) are dropped, as the schema says.
import type { DiagramEvent, Report, ReportJson, ReportOptions, Scenario, ScenarioJson } from '../types'
import { DEFAULT_LABEL_MAX_WIDTH } from '../ui/format'

/** The options a report that names none was written with. No usage ping without a say-so. */
export const DEFAULT_OPTIONS: ReportOptions = {
  metricsEnabled: true,
  labelMaxWidth: DEFAULT_LABEL_MAX_WIDTH,
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

// The same report object always gives the same normalised one, and a normalised one is its own.
const normalised = new WeakMap<object, Report>()

/** [report] with its optional fields filled in. Leaves [report] as it is. */
export function normaliseReport(report: ReportJson | Report): Report {
  const known = normalised.get(report)
  if (known) return known
  const result: Report = {
    ...report,
    options: { ...DEFAULT_OPTIONS, ...report.options },
    scenarios: report.scenarios.map(normaliseScenario),
  }
  normalised.set(report, result)
  normalised.set(result, result)
  return result
}

/**
 * [scenario] with its timing summary: what lsd-mono-core would have written for it, as far as
 * the events say. Accuracy is MEASURED when a message has a duration or start time, and
 * STRUCTURE_ONLY otherwise; the sources are the one local clock when there are messages.
 */
export function normaliseScenario(scenario: ScenarioJson): Scenario {
  // The generated type leaves unknown kinds out; a newer producer's report can still have them.
  const written: readonly { kind: string }[] = scenario.events
  const events = written.every(isKnownEvent) ? scenario.events : written.filter(isKnownEvent)
  const messages = events.filter((e) => e.kind === 'message')
  return {
    ...scenario,
    events,
    accuracy:
      scenario.accuracy ??
      (messages.some((m) => m.durationMs != null || m.startedAt != null) ? 'MEASURED' : 'STRUCTURE_ONLY'),
    sources: scenario.sources ?? (messages.length > 0 ? ['local'] : []),
    clockOrdering: scenario.clockOrdering ?? 'SAME_SOURCE',
    clockOrdered: scenario.clockOrdered ?? 0,
  }
}
