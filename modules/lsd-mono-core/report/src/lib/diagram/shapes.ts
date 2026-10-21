// Sequence diagram shapes: lanes, activation bars, participant heads, arrows and notes.
import type { MessageType, NotePlacement, Participant, ParticipantType } from '../../types'
import { escapeAttr, escapeHtml } from '../escape'
import { ACT_W, COL_GAP, EDGE_INSET, LEFT_PAD, SHORT_STUB, diagramWidth } from '../layout'
import { fitName } from '../participant-label'
import type { FittedName } from '../participant-label'

export type ArrowEnd = 'filled' | 'open' | 'lost' | 'none'

export interface MessageArrowSpec {
  /** Non-colour cue: dashed stroke for async / response. */
  dashed: boolean
  start: ArrowEnd
  end: ArrowEnd
  /** Accessible / visible type cue shown next to the label when shape alone may be subtle. */
  typeCue: string | null
}

/** Space kept between neighbouring participant shapes (or names) in the header. */
export const LANE_GAP = 20

/** Lifeline x per visible index, for index maps made by [laneIndex]. */
const laneXs = new WeakMap<Map<string, number>, number[]>()

/**
 * Lifeline centres. Lanes are COL_GAP apart unless two neighbouring shapes (or
 * names) are wider than that, in which case the pair moves apart to keep
 * LANE_GAP between them.
 */
export function laneCentres(visible: Participant[]): number[] {
  const halves = visible.map((p) => participantHeadFor(p).half)
  const xs: number[] = []
  halves.forEach((half, i) => {
    xs.push(i === 0 ? LEFT_PAD : xs[i - 1] + Math.max(COL_GAP, Math.ceil(halves[i - 1] + half + LANE_GAP)))
  })
  return xs
}

/** Participant id to visible index, carrying the lane centres for [xFor]. */
export function laneIndex(visible: Participant[]): Map<string, number> {
  const index = new Map(visible.map((p, i) => [p.id, i]))
  laneXs.set(index, laneCentres(visible))
  return index
}

/** Width of the lifeline area: the fixed-gap width plus whatever wide names added. */
export function laneWidth(index: Map<string, number>, count: number): number {
  const xs = laneXs.get(index)
  const extra = xs?.length ? xs[xs.length - 1] - (LEFT_PAD + (xs.length - 1) * COL_GAP) : 0
  return diagramWidth(count) + extra
}

/** Lifeline x. Index maps not made by [laneIndex] (tests) use the fixed gap. */
export function xFor(i: number, index?: Map<string, number>): number {
  return (index ? laneXs.get(index)?.[i] : undefined) ?? LEFT_PAD + i * COL_GAP
}

/**
 * Activation bar. [colour] overrides the participant fallback and adds a hatch plus
 * an accessible name. Absent colour keeps the plain bar (no hatch, no "coloured" label).
 */
export function activationBarSvg(args: {
  x: number
  y: number
  width: number
  height: number
  colour?: string
  fallback: string
}): string {
  const { x, y, width, height } = args
  if (!args.colour) {
    return `<rect class="activation" x="${x}" y="${y}" width="${width}" height="${height}" rx="3" style="--pc:${escapeAttr(args.fallback)}"/>`
  }
  const colour = escapeAttr(args.colour)
  return `<g class="activation-coloured" role="img" aria-label="coloured activation"><title>coloured activation</title><rect class="activation" x="${x}" y="${y}" width="${width}" height="${height}" rx="3" style="--pc:${colour}"/><rect class="activation-hatch" x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#act-tint-hatch)"/></g>`
}

/**
 * Header geometry for one captured participant type.
 * Unknown values (including legacy CONTROL / COLLECTIONS, which this model does not capture)
 * stay on the component box. The shape differs; [typeLabel] is the text cue.
 *
 * With a fitted [name], the box, cylinder and queue grow to hold it, and a
 * two-line name gets a taller shape (or, for the actor, entity and boundary
 * marks, a smaller mark) so both lines fit the same header height.
 */
/** How a participant's title names its type, after the name ("Orders, database"). */
export type ParticipantTypeLabel = 'actor' | 'database' | 'queue' | 'entity' | 'boundary' | 'component'

export interface ParticipantHead {
  type: ParticipantType
  typeLabel: ParticipantTypeLabel
  /** SVG for the shape only. The name is a separate text node. */
  shapeSvg: string
  /** Baseline for the participant name (first line), in header units. */
  labelY: number
  /** Baseline of each name line. */
  labelYs: number[]
  /** Half the width of the shape itself. Edges stop at this. */
  shapeHalf: number
  /** Half the width of the shape or its name, whichever is wider. Lanes keep this clear. */
  half: number
}

/** Smaller mark for a two-line name under an actor, entity or boundary. */
function smallMark(svg: string): string {
  return `<g transform="translate(0 -3) scale(0.8)">${svg}</g>`
}

/** Even width, so the shape stays centred on whole pixels. */
function evenUp(n: number): number {
  return 2 * Math.ceil(n / 2)
}

export function participantHead(type: string | undefined, name?: FittedName): ParticipantHead {
  const w = name?.width ?? 0
  const two = (name?.lines.length ?? 1) > 1
  const under = (head: Omit<ParticipantHead, 'labelY' | 'labelYs' | 'half'>): ParticipantHead => ({
    ...head,
    shapeSvg: two ? smallMark(head.shapeSvg) : head.shapeSvg,
    labelY: two ? 41 : 50,
    labelYs: two ? [41, 52] : [50],
    half: Math.max(head.shapeHalf, w / 2),
  })
  switch (type) {
    case 'ACTOR':
      return under({
        type: 'ACTOR',
        typeLabel: 'actor',
        shapeHalf: 11,
        shapeSvg: `<g class="participant-actor">
          <circle cx="0" cy="11" r="5.5"/>
          <path d="M0 16.5 V28 M-11 22 H11 M0 28 L-8 38 M0 28 L8 38"/>
        </g>`,
      })
    case 'DATABASE': {
      const rx = Math.max(46, Math.ceil(w / 2 + 10))
      const top = two ? 9 : 16
      const body = two ? 34 : 16
      return {
        type: 'DATABASE',
        typeLabel: 'database',
        labelY: two ? 28 : 30,
        labelYs: two ? [28, 40] : [30],
        shapeHalf: rx,
        half: rx,
        shapeSvg: `<g class="participant-database">
          <path class="participant-shape" d="M-${rx} ${top} v${body} a${rx} 6 0 0 0 ${rx * 2} 0 v-${body}"/>
          <ellipse class="participant-shape" cx="0" cy="${top}" rx="${rx}" ry="6"/>
        </g>`,
      }
    }
    case 'QUEUE': {
      const hw = Math.max(48, Math.ceil(w / 2 + 16))
      const bottom = two ? 50 : 44
      return {
        type: 'QUEUE',
        typeLabel: 'queue',
        labelY: two ? 31 : 34,
        labelYs: two ? [31, 43] : [34],
        shapeHalf: hw + 2,
        half: hw + 2,
        shapeSvg: `<g class="participant-queue">
          <polygon class="participant-shape participant-queue-back" points="${-hw + 4},6 ${hw - 14},6 ${hw - 2},16 ${-hw + 16},16"/>
          <polygon class="participant-shape" points="${-hw},18 ${hw - 12},18 ${hw + 2},${bottom} ${-hw + 14},${bottom}"/>
        </g>`,
      }
    }
    case 'ENTITY':
      return under({
        type: 'ENTITY',
        typeLabel: 'entity',
        shapeHalf: 14,
        shapeSvg: `<circle class="participant-shape" cx="0" cy="22" r="14"/>`,
      })
    case 'BOUNDARY':
      return under({
        type: 'BOUNDARY',
        typeLabel: 'boundary',
        shapeHalf: 16,
        shapeSvg: `<g class="participant-boundary">
          <line class="participant-mark" x1="-16" y1="6" x2="-16" y2="38"/>
          <circle class="participant-shape" cx="0" cy="22" r="14"/>
        </g>`,
      })
    default: {
      const rw = Math.max(96, evenUp(w + 20))
      return {
        type: 'PARTICIPANT',
        typeLabel: 'component',
        labelY: two ? 25 : 32,
        labelYs: two ? [25, 37] : [32],
        shapeHalf: rw / 2,
        half: rw / 2,
        shapeSvg: `<rect class="participant-shape" x="${-rw / 2}" y="${two ? 8 : 14}" width="${rw}" height="${two ? 40 : 28}" rx="4"/>`,
      }
    }
  }
}

/** Header geometry for a participant with its displayed name fitted. */
export function participantHeadFor(p: {
  type?: string
  name: string
  alias?: string
}): ParticipantHead & { name: FittedName } {
  const name = fitName(p.alias ?? p.name)
  return { ...participantHead(p.type, name), name }
}

/**
 * The participant name as SVG text: one line as plain text (the common case), two
 * as tspans. The full name is in the shape's title, not here.
 */
export function participantLabelSvg(head: ParticipantHead, name: FittedName): string {
  if (name.lines.length === 1) {
    return `<text class="participant-label" y="${head.labelY}" text-anchor="middle">${escapeHtml(name.lines[0])}</text>`
  }
  const lines = name.lines.map((line, i) => `<tspan x="0" y="${head.labelYs[i]}">${escapeHtml(line)}</tspan>`).join('')
  return `<text class="participant-label" text-anchor="middle">${lines}</text>`
}

/** Shape/marker rules — colour alone must not distinguish these types (a11y). */
export function messageArrowSpec(type: MessageType): MessageArrowSpec {
  switch (type) {
    case 'ASYNCHRONOUS':
      return { dashed: true, start: 'none', end: 'open', typeCue: null }
    case 'SYNCHRONOUS_RESPONSE':
      return { dashed: true, start: 'none', end: 'filled', typeCue: null }
    case 'LOST':
      return { dashed: false, start: 'none', end: 'lost', typeCue: 'lost' }
    case 'BI_DIRECTIONAL':
      return { dashed: false, start: 'filled', end: 'filled', typeCue: '↔' }
    case 'SHORT_INBOUND':
      return { dashed: false, start: 'none', end: 'filled', typeCue: 'in' }
    case 'SHORT_OUTBOUND':
      return { dashed: false, start: 'none', end: 'filled', typeCue: 'out' }
    default:
      return { dashed: false, start: 'none', end: 'filled', typeCue: null }
  }
}

export function arrowMarker(id: string, colour: string, end: ArrowEnd): string {
  if (end === 'none') return ''
  const markerId = escapeAttr(id)
  const stroke = escapeAttr(colour)
  if (end === 'open') {
    return `<marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path class="arrow-ink-stroke" d="M1 1 L9 5 L1 9" fill="none" stroke="${stroke}" stroke-width="1.6" style="--pc:${stroke}"/>
    </marker>`
  }
  if (end === 'lost') {
    // X tip — shape cue distinct from a filled sync arrow (not colour-only).
    return `<marker id="${markerId}" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path class="arrow-ink-stroke" d="M2 2 L10 10 M10 2 L2 10" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" style="--pc:${stroke}"/>
    </marker>`
  }
  return `<marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path class="arrow-ink-fill" d="M0 0 L10 5 L0 10 z" fill="${stroke}" style="--pc:${stroke}"/>
  </marker>`
}

/**
 * XML ids cannot contain parentheses or a hash. A theme colour such as
 * `var(--accent)` was producing `url(#mk_filled_var(--accent))`, which the
 * browser drops, so only hex tips (sync responses) painted.
 */
function arrowMarkerId(end: ArrowEnd, colour: string): string {
  const safe = colour.replace(/[^A-Za-z0-9_-]/g, '')
  return `mk_${end}_${safe || 'colour'}`
}

export function markerSet(): {
  ensure: (colour: string, end: ArrowEnd) => string
  markup: () => string
} {
  const markers: string[] = []
  const seen = new Set<string>()
  return {
    ensure(colour, end) {
      if (end === 'none') return ''
      const id = arrowMarkerId(end, colour)
      if (!seen.has(id)) {
        seen.add(id)
        markers.push(arrowMarker(id, colour, end))
      }
      return id
    },
    markup: () => markers.join('\n'),
  }
}

/** A message drawn as a stub from one lifeline toward the diagram edge. */
export type ShortMessageType = Extract<MessageType, 'SHORT_INBOUND' | 'SHORT_OUTBOUND'>

/** Whether [type] is a short arrow. A type guard, since MessageType is open (any other string). */
export function isShortMessage(type: MessageType): type is ShortMessageType {
  return type === 'SHORT_INBOUND' || type === 'SHORT_OUTBOUND'
}

/**
 * Geometry for short arrows: stub toward the diagram edge from the real lifeline.
 * Does not invent a phantom participant column.
 */
export function shortMessageEndpoints(
  type: ShortMessageType,
  participantX: number,
  width: number,
): { x1: number; x2: number } {
  if (type === 'SHORT_INBOUND') {
    const x2 = participantX - ACT_W / 2
    const x1 = Math.max(EDGE_INSET, x2 - SHORT_STUB)
    return { x1, x2 }
  }
  const x1 = participantX + ACT_W / 2
  const x2 = Math.min(width - EDGE_INSET, x1 + SHORT_STUB)
  return { x1, x2 }
}

/** Gap between a short arrow's bar end and its label. */
const SHORT_LABEL_GAP = 4

/**
 * Short-arrow label position. Outbound labels start just past the bar edge and
 * run toward the diagram edge; inbound labels end just before it.
 */
export function shortLabelAnchor(
  type: ShortMessageType,
  x1: number,
  x2: number,
): { x: number; anchor: 'start' | 'end' } {
  return type === 'SHORT_OUTBOUND'
    ? { x: x1 + SHORT_LABEL_GAP, anchor: 'start' }
    : { x: x2 - SHORT_LABEL_GAP, anchor: 'end' }
}

export interface NoteLayout {
  /** Translate X for the note group (card is centred on 0). */
  x: number
  textAnchor: 'middle' | 'start' | 'end'
  placement: NotePlacement
}

export function noteLayout(
  placement: NotePlacement | undefined,
  over: string | undefined,
  index: Map<string, number>,
  width: number,
): NoteLayout {
  const place: NotePlacement = placement ?? 'over'
  const i = over ? (index.get(over) ?? 0) : 0
  const px = over ? xFor(i, index) : width / 2
  if (place === 'left') {
    const x = over ? px - 90 : LEFT_PAD
    return { x, textAnchor: 'middle', placement: 'left' }
  }
  if (place === 'right') {
    const x = over ? px + 90 : width - LEFT_PAD
    return { x, textAnchor: 'middle', placement: 'right' }
  }
  return { x: px, textAnchor: 'middle', placement: 'over' }
}
