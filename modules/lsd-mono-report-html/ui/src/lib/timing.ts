import type { MessageEvent, Scenario } from '../types'

/** One waterfall row: a message, its depth in the call tree and where it sits on the time axis. */
export interface TimelineRow {
  message: MessageEvent
  depth: number
  /** Offset from the scenario start, ms. */
  startMs: number
  /** The call's duration including children, or 0 for an untimed row. */
  spanMs: number
  /** Time not covered by children. */
  selfMs: number
  timed: boolean
  /** Children took longer than the call's own measured duration. */
  overrun: boolean
  /** The call's own measured duration, ms. */
  ownMs: number
  /** Total time of the calls inside it, ms. */
  childMs: number
  /** The participant the time is spent in: the callee. */
  participant: string
}

export interface Timeline {
  rows: TimelineRow[]
  totalMs: number
  /** Self time per participant, largest first. */
  byParticipant: { participant: string; ms: number }[]
  /** True when start offsets come from packing rather than timestamps. */
  approximate: boolean
  calls: number
  timedCalls: number
}

interface Node {
  message?: MessageEvent
  parent?: Node
  kids: Node[]
  own: number
  timed: boolean
  reply?: MessageEvent
  at?: number
  span: number
  self: number
  start: number
  childSum: number
}

const isCall = (m: MessageEvent) => m.type === 'synchronous' || m.type === 'bi_directional'

/**
 * Lays the report's call tree on a time axis. The tree comes from the report: each message's
 * `parentId` (the call it runs inside) and each paired reply's `replyTo`, worked out once in the
 * library (ids, spans, clock ordering). A call's duration is its `durationMs`: the report
 * writes a paired reply's duration on its call. Starts come from `startedAt` within a single source; otherwise children are packed
 * one after another inside their parent, and the timeline is marked approximate.
 */
export function timeline(scenario: Scenario): Timeline {
  let t = timelines.get(scenario)
  if (!t) {
    t = buildTimeline(scenario)
    timelines.set(scenario, t)
  }
  return t
}

/** One timeline per scenario: the strip and the Timing view share it. Scenarios are not mutated after load. */
const timelines = new WeakMap<Scenario, Timeline>()

function buildTimeline(scenario: Scenario): Timeline {
  const root: Node = { kids: [], own: 0, timed: false, span: 0, self: 0, start: 0, childSum: 0 }
  const nodes = new Map<string, Node>()
  // Start offsets only within one clock: the scenario's first source.
  const clock = scenario.sources[0] ?? 'local'
  const onClock = (e: MessageEvent) => (e.source ?? 'local') === clock
  let t0: number | undefined
  for (const e of scenario.events) {
    if (e.kind !== 'message') continue
    const at = onClock(e) && e.startedAt ? Date.parse(e.startedAt) : undefined
    if (at != null && !Number.isNaN(at)) t0 = t0 == null ? at : Math.min(t0, at)
  }
  for (const e of scenario.events) {
    if (e.kind !== 'message') continue
    if (e.type === 'synchronous_response') {
      const call = e.replyTo ? nodes.get(e.replyTo) : undefined
      if (call) call.reply = e
      continue
    }
    const parent = (e.parentId && nodes.get(e.parentId)) || root
    const startedAt = onClock(e) && e.startedAt ? Date.parse(e.startedAt) : NaN
    const node: Node = {
      message: e,
      parent,
      kids: [],
      own: e.durationMs ?? 0,
      timed: e.durationMs != null,
      at: !Number.isNaN(startedAt) && t0 != null ? startedAt - t0 : undefined,
      span: 0,
      self: 0,
      start: 0,
      childSum: 0,
    }
    parent.kids.push(node)
    nodes.set(e.id, node)
  }
  const measure = (n: Node): number => {
    n.childSum = n.kids.reduce((sum, k) => sum + measure(k), 0)
    n.span = Math.max(n.own, n.childSum)
    n.self = n.span - n.childSum
    return n.span
  }
  measure(root)
  let approximate = false
  const rows: TimelineRow[] = []
  const lay = (n: Node, start: number, depth: number) => {
    n.start = start
    if (n.message) {
      rows.push({
        message: n.message,
        depth,
        startMs: start,
        spanMs: n.span,
        selfMs: n.self,
        timed: n.timed || n.span > 0,
        overrun: n.timed && n.childSum > n.own,
        ownMs: n.own,
        childMs: n.childSum,
        participant: n.message.to || n.message.from,
      })
    }
    let cursor = start
    for (const k of n.kids) {
      let begin = cursor
      if (k.at != null) begin = Math.max(start, k.at)
      else if (k.span > 0 || k.timed) approximate = true
      lay(k, begin, depth + (n.message ? 1 : 0))
      cursor = Math.max(cursor, begin + k.span)
    }
  }
  lay(root, 0, 0)
  const totalMs = rows.reduce((max, r) => Math.max(max, r.startMs + r.spanMs), Math.max(scenario.wallClockMs ?? 0, 0))
  const self = new Map<string, number>()
  for (const r of rows) if (r.selfMs > 0) self.set(r.participant, (self.get(r.participant) ?? 0) + r.selfMs)
  const calls = rows.filter((r) => isCall(r.message))
  return {
    rows,
    totalMs,
    byParticipant: [...self.entries()].map(([participant, ms]) => ({ participant, ms })).sort((a, b) => b.ms - a.ms),
    approximate,
    calls: calls.length,
    timedCalls: calls.filter((r) => r.spanMs > 0).length,
  }
}

/** Whole ms below 10 s, one decimal under 10 ms. */
export function formatMs(ms: number): string {
  if (ms < 10 && ms % 1 !== 0) return `${ms.toFixed(1)} ms`
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.round(ms)} ms`
}

/** Whether the scenario has any timing worth a Timing view. */
export function hasTiming(scenario: Scenario): boolean {
  return scenario.accuracy !== 'structure_only'
}
