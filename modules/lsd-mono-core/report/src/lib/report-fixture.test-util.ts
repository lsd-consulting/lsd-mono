// Report pieces for tests that build reports by hand: what lsd-mono-core writes when there is
// nothing more to say, so a fixture names only what it is about. Spread them first, so the
// fixture's own fields win.
import type { IndexManifest } from '../generated/lsd-index'
import { REPORT_SCHEMA_VERSION, type DiagramEvent, type Report, type Scenario } from '../types'

/**
 * The timing summary lsd-mono-core writes for a scenario whose messages carry no timings: one
 * clock, `local`, or no clock at all when [events] has no messages. Pass the scenario's events
 * when it may have none; without them the scenario is taken to have messages.
 */
export function untimed(
  events?: readonly DiagramEvent[],
): Pick<Scenario, 'accuracy' | 'sources' | 'clockOrdering' | 'clockOrdered'> {
  const clocks = events && !events.some((e) => e.kind === 'message') ? [] : ['local']
  return { accuracy: 'STRUCTURE_ONLY', sources: clocks, clockOrdering: 'SAME_SOURCE', clockOrdered: 0 }
}

/** A report's schema version, status and default options, with the usage ping off. */
export function reportBase(): Pick<Report, 'schemaVersion' | 'status' | 'options'> {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    status: 'success',
    options: { metricsEnabled: true, labelMaxWidth: 200, usagePing: false, source: 'api' },
  }
}

/** An index manifest's schema version and options, with the usage ping off. */
export function indexBase(): Pick<IndexManifest, 'schemaVersion' | 'options'> {
  return { schemaVersion: REPORT_SCHEMA_VERSION, options: { usagePing: false } }
}
