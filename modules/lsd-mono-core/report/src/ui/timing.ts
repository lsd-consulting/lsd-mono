import { escapeAttr, escapeHtml } from '../lib/escape'
import { formatMs, hasTiming, timeline, type Timeline } from '../lib/timing'
import type { Accuracy, Scenario } from '../types'

const ACCURACY_LABEL: Record<Accuracy, string> = {
  STRUCTURE_ONLY: 'structure only',
  TIMESTAMPED: 'timestamped',
  MEASURED: 'measured',
  TRACED: 'traced',
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
  const accuracy = scenario.accuracy ?? 'MEASURED'
  const wall = Math.max(scenario.wallClockMs ?? 0, t.totalMs)
  const derivedWall = scenario.wallClockMs == null || scenario.wallClockMs < t.totalMs
  const clock = scenario.clockOrdered ?? 0
  const id = escapeAttr(scenario.id)
  const chip = (key: string, value: string, hint: string, extra = '') =>
    `<li><button type="button" class="timing-chip${escapeAttr(extra)}" data-show-metrics="${id}">
      <span class="k">${escapeHtml(key)}</span><span class="v">${escapeHtml(value)}</span><span class="h">${escapeHtml(hint)}</span>
    </button></li>`
  return `<ul class="timing-strip" aria-label="Timing summary">
    ${chip('Wall-clock', `${derivedWall ? '≈' : ''}${formatMs(wall)}`, derivedWall ? 'from durations' : `${scenario.sources?.length ?? 1} source`)}
    ${chip('Calls', String(t.calls), `${t.timedCalls} timed`)}
    ${chip('Slowest', top ? formatMs(top.spanMs) : '—', top?.message.label ?? 'nothing timed')}
    ${chip('Accuracy', ACCURACY_LABEL[accuracy], clock ? `${clock} clock-ordered` : pairingHint(scenario), clock ? ' clock' : '')}
  </ul>`
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
    `<span class="pill">${escapeHtml(ACCURACY_LABEL[scenario.accuracy ?? 'MEASURED'])}</span>`,
    t.approximate ? '<span class="pill">approximate start times</span>' : '',
    scenario.clockOrdered ? `<span class="pill clock">${scenario.clockOrdered} clock-ordered</span>` : '',
    ...(scenario.warnings ?? []).map(
      (w) => `<span class="pill warn" title="${escapeAttr(w)}">${escapeHtml(w.split(':')[0])}</span>`,
    ),
  ].join('')
  return `<section class="timing" aria-label="Timing">
    <div class="timing-notes">${notesHtml}</div>
    ${pairAccuracyHtml(scenario)}
    <h4>Time by participant <small>self time, ${escapeHtml(formatMs(t.totalMs))} total</small></h4>
    <div class="timing-stack" role="img" aria-label="Time by participant">${stack}</div>
    <ul class="timing-legend">${legend}</ul>
    <h4>Swim lanes <small>calls into each participant, on one time axis</small></h4>
    ${swimLanesHtml(scenario, t, colour, id)}
    <h4>Waterfall <small>solid = self · light = children · tick = untimed</small></h4>
    ${axisHtml(T)}
    <ol class="waterfall">${t.rows.map((r) => rowHtml(scenario, r, T, id)).join('')}</ol>
  </section>`
}

/** Which participant pairs are traced, measured, timestamped or structure only, when they differ. */
function pairAccuracyHtml(scenario: Scenario): string {
  const pairs = scenario.pairAccuracy ?? []
  if (!pairs.length) return ''
  const items = pairs
    .map(
      (p) =>
        `<li><span class="who">${escapeHtml(nameOf(scenario, p.from))} → ${escapeHtml(nameOf(scenario, p.to))}</span> <b class="acc-${escapeAttr(p.accuracy.toLowerCase())}">${escapeHtml(ACCURACY_LABEL[p.accuracy] ?? p.accuracy)}</b></li>`,
    )
    .join('')
  return `<h4>Accuracy by pair <small>the scenario is only as accurate as its weakest pair</small></h4>
    <ul class="pair-accuracy">${items}</ul>`
}

function axisHtml(total: number): string {
  const step = niceStep(total)
  const ticks: string[] = []
  for (let v = 0; v <= total + 1e-9; v += step)
    ticks.push(`<span style="left:${pct(v, total)}">${Math.round(v)}</span>`)
  return `<div class="wf-axis" aria-hidden="true"><span></span><span class="ticks">${ticks.join('')}</span><span></span></div>`
}

function niceStep(total: number): number {
  const raw = total / 4
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
}

function swimLanesHtml(scenario: Scenario, t: Timeline, colour: Map<string, number>, id: string): string {
  const lanes = t.byParticipant.map((p) => p.participant)
  if (!lanes.length) return '<p class="inspector-empty">No measured time to place in lanes.</p>'
  const T = t.totalMs || 1
  const rows = lanes
    .map((lane) => {
      const bars = t.rows
        .filter((r) => r.participant === lane && r.spanMs > 0)
        .map(
          (r) =>
            `<button type="button" class="lane-bar lane-c${colour.get(lane)}" style="left:${pct(r.startMs, T)};width:${pct(r.spanMs, T)}" data-show-message="${escapeAttr(r.message.id)}" data-scenario-id="${escapeAttr(id)}" title="${escapeAttr(`${r.message.label} · ${formatMs(r.spanMs)}`)}" aria-label="${escapeAttr(`${r.message.label}, ${formatMs(r.spanMs)}`)}"></button>`,
        )
        .join('')
      return `<li class="lane"><span class="lane-name">${escapeHtml(nameOf(scenario, lane))}</span><span class="lane-track">${bars}</span></li>`
    })
    .join('')
  return `<ol class="swim-lanes" aria-label="Swim lanes">${rows}</ol>`
}

function rowHtml(scenario: Scenario, r: Timeline['rows'][number], total: number, id: string): string {
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
  return `<li><button type="button" class="wf-row${m.order === 'CLOCK' ? ' clock' : ''}" style="--d:${r.depth}" data-show-message="${escapeAttr(m.id)}" data-scenario-id="${escapeAttr(id)}">
    <span class="wf-lab">${orderBadgesHtml(m.order, m.pairing)}<span class="who">${who}</span> ${escapeHtml(m.label)}${async}${r.overrun ? `<span class="warnx" title="${escapeAttr(`The calls inside took ${formatMs(r.childMs)}, longer than this call's measured ${formatMs(r.ownMs)}: the measurements disagree`)}">${escapeHtml(`Calls inside took longer: ${formatMs(r.childMs)} > ${formatMs(r.ownMs)}`)}</span>` : ''}</span>
    <span class="wf-track">${bar}</span>
    <span class="wf-dur">${dur}</span>
  </button></li>`
}
