import { escapeAttr, escapeHtml } from '../lib/escape'
import { formatMs, hasTiming, timeline, type Timeline } from '../lib/timing'
import { WATERFALL_FIRST_ROWS, WATERFALL_ROW_ESTIMATE_PX, paintsLanes, windowsWaterfall } from '../lib/timing-window'
import type { Accuracy, KnownWarningKind, Scenario } from '../types'

const ACCURACY_LABEL: Record<Accuracy, string> = {
  STRUCTURE_ONLY: 'structure only',
  TIMESTAMPED: 'timestamped',
  MEASURED: 'measured',
  TRACED: 'traced',
}

// A kind this UI does not know (from a newer producer) shows as it is.
const WARNING_LABEL: Record<KnownWarningKind, string> & Partial<Record<string, string>> = {
  REPLY_WITHOUT_CALL: 'reply without call',
  DURATION_ON_REPLY_DROPPED: 'duration on reply dropped',
  LONGER_THAN_PARENT: 'longer than parent',
  DUPLICATE_SPAN: 'duplicate span',
  SKEW: 'skew',
}

const LANE_COLOURS = 6

const participantsById = new WeakMap<Scenario, Map<string, Scenario['participants'][number]>>()

function nameOf(scenario: Scenario, id: string): string {
  let byId = participantsById.get(scenario)
  if (!byId) {
    byId = new Map(scenario.participants.map((p) => [p.id, p]))
    participantsById.set(scenario, byId)
  }
  const p = byId.get(id)
  return p?.alias || p?.name || id || '∅'
}

const pct = (v: number, total: number) => `${total > 0 ? ((100 * v) / total).toFixed(3) : 0}%`

/**
 * Summary strip in the scenario card: wall-clock, calls, slowest call and accuracy. Each chip
 * opens the Timing view. Absent for a structure-only scenario.
 */
export function timingStripHtml(scenario: Scenario): string {
  if (!hasTiming(scenario)) return ''
  const t = timeline(scenario)
  const slowest = t.rows.filter((r) => r.spanMs > 0).sort((a, b) => b.spanMs - a.spanMs || a.depth - b.depth)
  const top = slowest.find((r) => r.depth > 0) ?? slowest[0]
  const accuracy = accuracyLabel(scenario.accuracy)
  const wall = Math.max(scenario.wallClockMs ?? 0, t.totalMs)
  const derivedWall = scenario.wallClockMs == null || scenario.wallClockMs < t.totalMs
  const clock = scenario.clockOrdered
  const id = escapeAttr(scenario.id)
  // A chip with a [section] opens the panel at that section (the Accuracy chip: Accuracy by pair).
  const chip = (key: string, value: string, hint: string, extra = '', section = '') =>
    `<li><button type="button" class="timing-chip${escapeAttr(extra)}" data-show-metrics="${id}"${section ? ` data-metrics-section="${escapeAttr(section)}"` : ''}>
      <span class="k">${escapeHtml(key)}</span><span class="v">${escapeHtml(value)}</span><span class="h">${escapeHtml(hint)}</span>
    </button></li>`
  return `<ul class="timing-strip" aria-label="Timing summary">
    ${chip('Wall-clock', `${derivedWall ? '≈' : ''}${formatMs(wall)}`, derivedWall ? 'from durations' : sourcesHint(scenario.sources.length))}
    ${chip('Calls', String(t.calls), `${t.timedCalls} timed`)}
    ${chip('Slowest', top ? formatMs(top.spanMs) : '—', top?.message.label ?? 'nothing timed')}
    ${chip('Accuracy', accuracy, clock ? `${clock} clock-ordered` : pairingHint(scenario), clock ? ' clock' : '', scenario.pairAccuracy?.length ? PAIR_ACCURACY_SECTION : '')}
  </ul>`
}

/** "1 source", "3 sources". */
function sourcesHint(n: number): string {
  return `${n} ${n === 1 ? 'source' : 'sources'}`
}

/** A newer core may send an accuracy this report does not know: show it as sent. */
function accuracyLabel(accuracy: Accuracy): string {
  return ACCURACY_LABEL[accuracy] ?? accuracy
}

function pairingHint(scenario: Scenario): string {
  const p = scenario.pairingCoverage
  return p == null ? 'no calls' : `${Math.round(p * 100)}% exactly paired`
}

/** Badges for one message: clock-ordered, guessed pairing. */
function orderBadgesHtml(order?: string, pairing?: string): string {
  return [
    order === 'CLOCK'
      ? '<span class="tbadge clock" title="Placed by its start time, not capture order">clock</span>'
      : '',
    pairing === 'GUESSED'
      ? '<span class="tbadge guessed" title="Reply matched by direction, not by id">guessed</span>'
      : '',
  ].join('')
}

/**
 * The Timing view: time by participant, swim lanes (one lane per participant, self time on a
 * shared axis) and the waterfall (one row per message, bars for timed calls, ticks for untimed).
 * Rows open their message.
 */
export function timingPanelHtml(scenario: Scenario): string {
  if (!hasTiming(scenario)) return '<p class="inspector-empty">No timing captured.</p>'
  const t = timeline(scenario)
  const T = t.totalMs || 1
  const colour = new Map(t.byParticipant.map((p, i) => [p.participant, i % LANE_COLOURS]))
  const id = scenario.id
  const stack = t.byParticipant
    .map(
      (p) =>
        `<span class="lane-c${colour.get(p.participant)}" style="width:${pct(p.ms, T)}" title="${escapeAttr(nameOf(scenario, p.participant))} ${escapeAttr(formatMs(p.ms))}"></span>`,
    )
    .join('')
  const legend = t.byParticipant
    .map(
      (p) =>
        `<li><i class="lane-c${colour.get(p.participant)}"></i>${escapeHtml(nameOf(scenario, p.participant))} <b>${escapeHtml(formatMs(p.ms))}</b> <em>${Math.round((100 * p.ms) / T)}%</em></li>`,
    )
    .join('')
  const notesHtml = [
    `<span class="pill">${escapeHtml(accuracyLabel(scenario.accuracy))}</span>`,
    t.approximate ? '<span class="pill">approximate start times</span>' : '',
    scenario.clockOrdered ? `<span class="pill clock">${scenario.clockOrdered} clock-ordered</span>` : '',
    ...(scenario.warnings ?? []).map(
      (w) =>
        `<span class="pill warn" title="${escapeAttr(`${WARNING_LABEL[w.kind] ?? w.kind}: ${w.message}`)}">${escapeHtml(WARNING_LABEL[w.kind] ?? w.kind)}</span>`,
    ),
  ].join('')
  return `<section class="timing" aria-label="Timing">
    <div class="timing-notes">${notesHtml}</div>
    <h3>Time by participant <small>self time, ${escapeHtml(formatMs(t.totalMs))} total</small></h3>
    <div class="timing-stack" role="img" aria-label="Time by participant">${stack}</div>
    <ul class="timing-legend">${legend}</ul>
    <h3>Swim lanes <small>calls into each participant, on one time axis</small></h3>
    ${swimLanesHtml(scenario, t)}
    <h3>Waterfall <small>solid = self · light = children · tick = untimed</small></h3>
    ${axisHtml(T)}
    ${waterfallHtml(scenario, t, T, id)}
  </section>`
}

/** The panel section the Accuracy chip opens at (`data-panel-section`). */
export const PAIR_ACCURACY_SECTION = 'pair-accuracy'

/** Up to this many pairs the list shows open; more fold into a summary line. */
export const PAIRS_SHOWN_OPEN = 6

/** Best to worst, for the summary's counts. */
const ACCURACY_ORDER: readonly string[] = ['TRACED', 'MEASURED', 'TIMESTAMPED', 'STRUCTURE_ONLY']

/** "20 pairs · 12 traced, 6 timestamped, 2 structure only": the count, then each level's, best first. */
export function pairAccuracySummary(pairs: readonly { accuracy: Accuracy }[]): string {
  const counts = new Map<string, number>()
  for (const p of pairs) counts.set(p.accuracy, (counts.get(p.accuracy) ?? 0) + 1)
  const rank = (a: string) => (ACCURACY_ORDER.includes(a) ? ACCURACY_ORDER.indexOf(a) : ACCURACY_ORDER.length)
  const levels = [...counts.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([a, n]) => `${n} ${accuracyLabel(a as Accuracy)}`)
  return `${pairs.length} ${pairs.length === 1 ? 'pair' : 'pairs'} · ${levels.join(', ')}`
}

/**
 * Which participant pairs are traced, measured, timestamped or structure only, when they differ:
 * the last section of the Timing and metrics panel (drill-down detail; the overall accuracy is at
 * the top). More than [PAIRS_SHOWN_OPEN] pairs start folded under a summary of the counts.
 * Empty without pair data or without timing (the panel then has no timing sections either).
 */
export function pairAccuracySectionHtml(scenario: Scenario): string {
  const pairs = scenario.pairAccuracy ?? []
  if (!pairs.length || !hasTiming(scenario)) return ''
  const items = pairs
    .map(
      (p) =>
        `<li><span class="who">${escapeHtml(nameOf(scenario, p.from))} → ${escapeHtml(nameOf(scenario, p.to))}</span> <b class="acc-${escapeAttr(p.accuracy.toLowerCase())}">${escapeHtml(accuracyLabel(p.accuracy))}</b></li>`,
    )
    .join('')
  const list = `<ul class="pair-accuracy">${items}</ul>`
  const body =
    pairs.length > PAIRS_SHOWN_OPEN
      ? `<details class="pair-accuracy-more"><summary>${escapeHtml(pairAccuracySummary(pairs))}</summary>${list}</details>`
      : list
  return `<div class="panel-section" data-panel-section="${PAIR_ACCURACY_SECTION}">
    <h3>Accuracy by pair <small>the scenario is only as accurate as its weakest pair</small></h3>
    ${body}
  </div>`
}

/** Axis ticks in ms: a round step, at least two ticks, labels that say the step (0.2, 500, 2 s). */
export function axisHtml(total: number): string {
  const step = niceStep(total)
  const ticks: string[] = []
  // Count ticks rather than adding the step up, so 0.1 + 0.2 never drifts past the last tick.
  for (let i = 0; i * step <= total + step * 1e-9; i++)
    ticks.push(`<span style="left:${pct(i * step, total)}">${tickLabel(i * step, step)}</span>`)
  return `<div class="wf-axis" aria-hidden="true"><span></span><span class="ticks">${ticks.join('')}</span><span></span></div>`
}

/** 1, 2 or 5 times a power of ten, about a quarter of `total`; below 1 ms too (durations can be fractional). */
export function niceStep(total: number): number {
  const raw = total / 4
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw * (1 - 1e-9)) ?? raw
}

/** A tick in ms, in seconds from a one-second step, with as many decimals as the step needs. */
export function tickLabel(v: number, step: number): string {
  if (step >= 1000) return `${+(v / 1000).toFixed(Math.max(0, -Math.floor(Math.log10(step / 1000))))} s`
  if (step >= 1) return String(Math.round(v))
  return v.toFixed(Math.ceil(-Math.log10(step) - 1e-9))
}

/** One swim lane: a participant, its colour and the calls into it with measured time. */
export interface LaneTrack {
  participant: string
  /** lane-cN */
  colour: number
  bars: Timeline['rows']
}

const laneCache = new WeakMap<Timeline, LaneTrack[]>()

/** The swim lanes of [t], largest self time first, as the panel draws them. */
export function laneTracks(t: Timeline): LaneTrack[] {
  let lanes = laneCache.get(t)
  if (!lanes) {
    const byLane = new Map<string, Timeline['rows']>(t.byParticipant.map((p) => [p.participant, []]))
    for (const r of t.rows) if (r.spanMs > 0) byLane.get(r.participant)?.push(r)
    lanes = t.byParticipant.map((p, i) => ({
      participant: p.participant,
      colour: i % LANE_COLOURS,
      bars: byLane.get(p.participant) ?? [],
    }))
    laneCache.set(t, lanes)
  }
  return lanes
}

/** Bar [j] of [lane] in [scenario]'s swim lanes: a button that opens its message. */
export function laneBarHtml(scenario: Scenario, lane: LaneTrack, j: number): string {
  const r = lane.bars[j]
  if (!r) return ''
  const T = timeline(scenario).totalMs || 1
  return `<button type="button" class="lane-bar lane-c${lane.colour}" style="left:${pct(r.startMs, T)};width:${pct(r.spanMs, T)}" data-show-message="${escapeAttr(r.message.id)}" data-scenario-id="${escapeAttr(scenario.id)}" title="${escapeAttr(`${r.message.label} · ${formatMs(r.spanMs)}`)}" aria-label="${escapeAttr(`${r.message.label}, ${formatMs(r.spanMs)}`)}"></button>`
}

/**
 * The swim lanes. Many bars (paintsLanes) are painted on a canvas per lane, with one button per
 * lane standing on its first bar; mountLaneCanvas (timing-window.ts) paints them and moves the
 * button to the bar under the pointer or the keyboard (#90c).
 */
function swimLanesHtml(scenario: Scenario, t: Timeline): string {
  const lanes = laneTracks(t)
  if (!lanes.length) return '<p class="inspector-empty">No measured time to place in lanes.</p>'
  const painted = paintsLanes(lanes.reduce((n, l) => n + l.bars.length, 0))
  const rows = lanes
    .map((lane, k) => {
      const barsHtml = painted
        ? `<canvas class="lane-canvas" aria-hidden="true"></canvas>${laneBarHtml(scenario, lane, 0)}`
        : lane.bars.map((_, j) => laneBarHtml(scenario, lane, j)).join('')
      const trackAttrs = painted ? ` data-lane="${k}"` : ''
      return `<li class="lane"><span class="lane-name">${escapeHtml(nameOf(scenario, lane.participant))}</span><span class="lane-track"${trackAttrs}>${barsHtml}</span></li>`
    })
    .join('')
  return `<ol class="swim-lanes" aria-label="Swim lanes"${painted ? ' data-lane-canvas' : ''}>${rows}</ol>`
}

/**
 * The waterfall list. A long one (windowsWaterfall) starts with its first rows and room for the
 * rest; mountWaterfallWindow (timing-window.ts) then keeps the rows around the scroll position
 * drawn (#90b). Each drawn row says its place in the whole list (aria-posinset of aria-setsize).
 */
function waterfallHtml(scenario: Scenario, t: Timeline, total: number, id: string): string {
  const n = t.rows.length
  if (!windowsWaterfall(n))
    return `<ol class="waterfall">${t.rows.map((r) => rowHtml(scenario, r, total, id)).join('')}</ol>`
  const first = Math.min(n, WATERFALL_FIRST_ROWS)
  const rest = (n - first) * WATERFALL_ROW_ESTIMATE_PX
  const rows: string[] = []
  for (let i = 0; i < first; i++) rows.push(waterfallRowHtml(scenario, i))
  return `<ol class="waterfall" data-waterfall-window="${escapeAttr(id)}" data-rows="${n}" style="padding-bottom:${rest}px">${rows.join('')}</ol>`
}

/** Row [i] of [scenario]'s windowed waterfall, marked with its index and its place in the list. */
export function waterfallRowHtml(scenario: Scenario, i: number): string {
  const t = timeline(scenario)
  const r = t.rows[i]
  if (!r) return ''
  const placeHtml = ` data-i="${i}" aria-posinset="${i + 1}" aria-setsize="${t.rows.length}"`
  return rowHtml(scenario, r, t.totalMs || 1, scenario.id, placeHtml)
}

function rowHtml(scenario: Scenario, r: Timeline['rows'][number], total: number, id: string, placeHtml = ''): string {
  const m = r.message
  const who = `${escapeHtml(nameOf(scenario, m.from))} → ${escapeHtml(nameOf(scenario, m.to))}`
  const bar =
    r.spanMs > 0
      ? `<span class="wf-bar" style="left:${pct(r.startMs, total)};width:${pct(r.spanMs, total)}"><span class="wf-self" style="width:${((100 * r.selfMs) / r.spanMs).toFixed(2)}%"></span></span>`
      : `<span class="wf-tick" style="left:${pct(r.startMs, total)}"></span>`
  const dur = r.spanMs > 0 ? `${escapeHtml(formatMs(r.spanMs))}` : '<span class="nt">—</span>'
  const async =
    m.type === 'ASYNCHRONOUS' || m.type === 'LOST'
      ? ` <span class="tag">${escapeHtml(m.type.toLowerCase())}</span>`
      : ''
  return `<li${placeHtml}><button type="button" class="wf-row${m.order === 'CLOCK' ? ' clock' : ''}" style="--d:${r.depth}" data-show-message="${escapeAttr(m.id)}" data-scenario-id="${escapeAttr(id)}">
    <span class="wf-lab">${orderBadgesHtml(m.order, m.pairing)}<span class="who">${who}</span> ${escapeHtml(m.label)}${async}${r.overrun ? `<span class="warnx" title="${escapeAttr(`The calls inside took ${formatMs(r.childMs)}, longer than this call's measured ${formatMs(r.ownMs)}: the measurements disagree`)}">${escapeHtml(`Calls inside took longer: ${formatMs(r.childMs)} > ${formatMs(r.ownMs)}`)}</span>` : ''}</span>
    <span class="wf-track">${bar}</span>
    <span class="wf-dur">${dur}</span>
  </button></li>`
}
