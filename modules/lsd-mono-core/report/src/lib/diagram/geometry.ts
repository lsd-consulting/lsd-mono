// Diagram geometry (#100): the frame and pads, arrow ends, label boxes and what a slice paints.
// A leaf of the diagram modules: it imports none of them but shapes and state's types, so the
// rest can all use it without an import cycle.
import type { DiagramEvent, MessageEvent, Participant } from '../../types'
import { DEFAULT_LABEL_MAX_WIDTH, truncateLabel } from '../../ui/format'
import { messageHasPayload } from '../diagram-a11y'
import { eventHiddenByColumns, messageLabelRect, visibleParticipants } from '../diagram-view'
import type { Rect } from '../diagram-view'
import { ACT_NEST_DX, ACT_W, EDGE_MARGIN, MESSAGE_LABEL_RISE, MSG_CHAR_W, NOTE_CARD_W } from '../layout'
import type { LayoutRow } from '../layout'
import {
  laneIndex,
  laneWidth,
  messageArrowSpec,
  noteLayout,
  participantHeadFor,
  shortLabelAnchor,
  shortMessageEndpoints,
  xFor,
  isShortMessage,
} from './shapes'
import type { DiagramFrame, MountedDiagram } from './state'

export function frameOf(diagram: MountedDiagram, hiddenIds: ReadonlySet<string>): DiagramFrame {
  const visible = visibleParticipants(diagram.scenario.participants, hiddenIds)
  const base = laneWidth(laneIndex(visible), visible.length)
  const pads = diagramPads(diagram.scenario.events, visible, diagram.labelMaxWidth)
  return { base, ...pads, total: base + pads.left + pads.right }
}

/** Approximate drawn width of a message label with its type cue and duration. */
function messageLabelWidth(msg: MessageEvent, labelMaxWidth: number): number {
  const cue = messageArrowSpec(msg.type).typeCue
  let text = truncateLabel(msg.label, labelMaxWidth)
  if (cue) text += ` [${cue}]`
  if (msg.durationMs != null) text += ` · ${msg.durationMs}ms`
  if (messageHasPayload(msg)) text += '  {}'
  return text.length * MSG_CHAR_W
}

/** Where a self-call label starts, relative to its lifeline (see renderMessageRow). */
const SELF_LABEL_DX = ACT_W + 36 + 8

/**
 * Extra room needed left and right of the lifeline area so nothing on the
 * outer lifelines is clipped: notes left or right of a lifeline, self-call
 * labels, short-arrow labels, and long labels between the first or last pair.
 * Only content on the given (visible) participants counts.
 */
export function diagramPads(
  events: DiagramEvent[],
  visible: Participant[],
  labelMaxWidth = DEFAULT_LABEL_MAX_WIDTH,
): { left: number; right: number } {
  const index = laneIndex(visible)
  const width = laneWidth(index, visible.length)
  let minX = EDGE_MARGIN
  let maxX = width - EDGE_MARGIN
  const reach = (from: number, to: number) => {
    minX = Math.min(minX, from)
    maxX = Math.max(maxX, to)
  }
  // Header shapes and names on the outer lifelines.
  visible.forEach((p, i) => {
    const half = participantHeadFor(p).half
    reach(xFor(i, index) - half, xFor(i, index) + half)
  })
  for (const event of events) {
    if (event.kind === 'note') {
      if (event.over && !index.has(event.over)) continue
      const { x } = noteLayout(event.placement, event.over, index, width)
      reach(x - NOTE_CARD_W / 2, x + NOTE_CARD_W / 2)
      continue
    }
    if (event.kind !== 'message') continue
    const w = messageLabelWidth(event, labelMaxWidth)
    if (isShortMessage(event.type)) {
      const id = event.type === 'SHORT_INBOUND' ? event.to : event.from
      const i = index.get(id)
      if (i === undefined) continue
      // Nested bars can push the stub right by a few px; allow two levels.
      const { x1, x2 } = shortMessageEndpoints(event.type, xFor(i, index), width)
      const label = shortLabelAnchor(event.type, x1, x2)
      if (label.anchor === 'start') reach(x1, label.x + w + 2 * ACT_NEST_DX)
      else reach(label.x - w, x2 + 2 * ACT_NEST_DX)
      continue
    }
    const fi = index.get(event.from)
    const ti = index.get(event.to)
    if (fi === undefined || ti === undefined) continue
    if (event.from === event.to) {
      const x = xFor(fi, index)
      reach(x, x + SELF_LABEL_DX + 2 * ACT_NEST_DX + w)
      continue
    }
    const mid = (xFor(fi, index) + xFor(ti, index)) / 2
    reach(mid - w / 2, mid + w / 2)
  }
  return {
    left: Math.ceil(Math.max(0, EDGE_MARGIN - minX)),
    right: Math.ceil(Math.max(0, maxX - (width - EDGE_MARGIN))),
  }
}

/**
 * Print draws the diagram across the page width. A small diagram grows at most
 * this much, so a two-lifeline sequence does not print with huge labels.
 */
export const PRINT_MAX_UPSCALE = 1.5

export function paintedMessageIds(slice: LayoutRow[], hiddenIds: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>()
  for (const row of slice) {
    const event = row.event
    if (event.kind === 'message' && messageHasPayload(event) && !eventHiddenByColumns(event, hiddenIds))
      ids.add(event.id)
  }
  return ids
}

export function messageEndpoints(
  msg: MessageEvent,
  index: Map<string, number>,
  width: number,
): { x1: number; x2: number } {
  if (isShortMessage(msg.type)) {
    const participantId = msg.type === 'SHORT_INBOUND' ? msg.to : msg.from
    const px = xFor(index.get(participantId) ?? 0, index)
    return shortMessageEndpoints(msg.type, px, width)
  }
  const fi = index.get(msg.from) ?? 0
  const ti = index.get(msg.to) ?? 0
  return { x1: xFor(fi, index), x2: xFor(ti, index) }
}

/** SVG viewBox top. Includes the label drawn above the first painted row. */
export function sliceViewTop(firstRowY: number): number {
  return Math.max(0, firstRowY - MESSAGE_LABEL_RISE)
}

/** Label box of a message row, in drawn coordinates (they start frame.left left of x = 0). */
export function messageLabelBox(diagram: MountedDiagram, hiddenIds: ReadonlySet<string>, row: LayoutRow): Rect | null {
  const event = row.event
  if (event.kind !== 'message' || eventHiddenByColumns(event, hiddenIds)) return null
  const frame = frameOf(diagram, hiddenIds)
  const index = laneIndex(visibleParticipants(diagram.scenario.participants, hiddenIds))
  const ends = messageEndpoints(event, index, frame.base)
  const rect = messageLabelRect({ arrowY: row.y, x1: ends.x1, x2: ends.x2 })
  return { ...rect, x: rect.x + frame.left }
}

/** Label box of the uppermost message still drawn. The default view scrolls this into view. */
export function topMessageLabelRect(diagram: MountedDiagram, hiddenIds: ReadonlySet<string>): Rect {
  for (const row of diagram.rows) {
    const box = messageLabelBox(diagram, hiddenIds, row)
    if (box) return box
  }
  return { x: 0, y: 0, width: 1, height: 1 }
}
