/** The message fields the timing shares read. */
interface TimedEvent {
  id?: unknown
  type?: unknown
  durationMs?: unknown
  replyTo?: unknown
}

/**
 * A scenario's measuredRatio and pairedRatio, as the core counts them (EventTiming): calls are the
 * synchronous messages; one is measured when it has a duration and paired when a reply names it in
 * replyTo. Both are absent when there are no calls, as the report schema says.
 */
export function callShares(events: readonly TimedEvent[]): { measuredRatio?: number; pairedRatio?: number } {
  const calls = events.filter((event) => event.type === 'synchronous')
  if (calls.length === 0) return {}
  const answered = new Set(events.map((event) => event.replyTo))
  return {
    measuredRatio: calls.filter((call) => typeof call.durationMs === 'number').length / calls.length,
    pairedRatio: calls.filter((call) => answered.has(call.id)).length / calls.length,
  }
}
