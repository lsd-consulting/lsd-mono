import type { Scenario } from '../types'

/**
 * Which scenario the report shows (#39). The sidebar is the only scenario menu,
 * and the main column shows the selected scenario alone.
 */

/** The first failing scenario, otherwise the first. Null for an empty report. */
export function defaultScenarioId(scenarios: readonly Scenario[]): string | null {
  return (scenarios.find((s) => s.status === 'error') ?? scenarios[0])?.id ?? null
}

/**
 * The scenario to show once search or the status filters have narrowed the list
 * to `matches`. The current one if it still matches; otherwise the next match after
 * it in report order, else the nearest one before it. Null when nothing matches.
 */
export function reselect(
  all: readonly Scenario[],
  matches: readonly Scenario[],
  currentId: string | null,
): string | null {
  if (!matches.length) return null
  if (currentId && matches.some((s) => s.id === currentId)) return currentId
  const at = currentId ? all.findIndex((s) => s.id === currentId) : -1
  if (at < 0) return matches[0].id
  const order = new Map(all.map((s, i) => [s.id, i]))
  const after = matches.find((s) => (order.get(s.id) ?? 0) > at)
  return (after ?? matches[matches.length - 1]).id
}

/** One step through the listed scenarios (j/k, arrows). Stops at either end. */
export function stepSelection(matches: readonly Scenario[], currentId: string | null, delta: number): string | null {
  if (!matches.length) return null
  const at = matches.findIndex((s) => s.id === currentId)
  if (at < 0) return matches[delta < 0 ? matches.length - 1 : 0].id
  return matches[Math.max(0, Math.min(matches.length - 1, at + delta))].id
}
