// Sequence diagram rows: header, the painted window, and one SVG row per event.
import type { MessageEvent, Participant, Scenario } from '../../types'
import { truncateLabel } from '../../ui/format'
import {
  TOUCH_HIT_CSS,
  focusableNeighbors,
  messageHasPayload,
  messageHitBox,
  messagePlaces,
  tabindexFor,
} from '../diagram-a11y'
import { isCoarsePointer } from '../media'
import { type FindMatch, eventHiddenByColumns, findMatch, messageLabelRect, visibleParticipants } from '../diagram-view'
import { escapeAttr, escapeHtml } from '../escape'
import { isErrorStatus } from '../status'
import {
  ACT_NEST_DX,
  ACT_W,
  BOTTOM_PAD,
  HEADER_BLOCK_H,
  LEFT_PAD,
  NOTE_LINE_H,
  SECTION_BAND_H,
  SECTION_BAND_Y,
  SELF_RETURN_DY,
  activationDepthAt,
  activationSpans,
  noteCardMetrics,
} from '../layout'
import type { LayoutRow } from '../layout'
import { headActionsHtml, headSlotStyle, headSlots, type HeadSlot } from '../filter/markup'
import {
  type ArrowEnd,
  activationBarSvg,
  laneIndex,
  markerSet,
  messageArrowSpec,
  noteLayout,
  participantHead,
  participantHeadFor,
  participantLabelSvg,
  shortLabelAnchor,
  shortMessageEndpoints,
  xFor,
  isShortMessage,
} from './shapes'
import { payloadMatches } from './payload-find'
import { messageSpeech } from './text-view'
import { type DiagramFrame, type DiagramView, EMPTY_PAINT, type MountedDiagram, type RowPaint } from './state'
import { messageEndpoints } from './geometry'

/** Diagonal hatch so a coloured activation is not colour-only (colour blindness). */
const ACTIVATION_HATCH =
  '<pattern id="act-tint-hatch" patternUnits="userSpaceOnUse" width="6" height="6"><path d="M0 6 L6 0" fill="none" stroke="#111" stroke-width="1.2"/></pattern>'

/** "hide:<id>" or "more:<id>": which header button holds the roving tab stop. */
export function headActionKey(btn: HTMLElement): string | null {
  const hide = btn.dataset.hideParticipant
  if (hide != null) return `hide:${hide}`
  const more = btn.dataset.participantMenu
  return more != null ? `more:${more}` : null
}

/** Sticky header: the drawn participants, and each one's Hide and More buttons over it. */
export function headerHtml(
  scenario: Scenario,
  frame: DiagramFrame,
  hiddenIds: ReadonlySet<string>,
  zoom: number,
  focusKey: string | null,
): string {
  const slots = headerSlots(scenario, frame, hiddenIds, zoom)
  return headerSvg(scenario, frame, hiddenIds, zoom) + headActionsHtml(slots, HEADER_BLOCK_H * zoom, focusKey)
}

/**
 * Bring a drawn header to [zoom] in place (#101): the same nodes, resized, so focus, the row's tab
 * stop and the buttons' state stay as they are. False, changing nothing, when its lanes are not the
 * ones [hiddenIds] leaves (lanes hidden or shown): then it is drawn afresh with headerHtml.
 */
export function resizeHeader(
  header: HTMLElement,
  scenario: Scenario,
  frame: DiagramFrame,
  hiddenIds: ReadonlySet<string>,
  zoom: number,
): boolean {
  const svg = header.querySelector('.seq-header-svg')
  const row = header.querySelector<HTMLElement>('.participant-heads')
  const heads = row ? [...row.querySelectorAll<HTMLElement>(':scope > [data-participant-head]')] : []
  const slots = headerSlots(scenario, frame, hiddenIds, zoom)
  if (!svg || !row || heads.length !== slots.length) return false
  if (slots.some((slot, i) => heads[i].dataset.participantHead !== slot.id)) return false
  const height = HEADER_BLOCK_H * zoom
  svg.setAttribute('viewBox', `${-frame.left} 0 ${frame.total} ${HEADER_BLOCK_H}`)
  svg.setAttribute('width', String(frame.total * zoom))
  svg.setAttribute('height', String(height))
  heads.forEach((head, i) => head.setAttribute('style', headSlotStyle(slots[i], height)))
  return true
}

function headerSlots(
  scenario: Scenario,
  frame: DiagramFrame,
  hiddenIds: ReadonlySet<string>,
  zoom: number,
): HeadSlot[] {
  const visible = visibleParticipants(scenario.participants, hiddenIds)
  const index = laneIndex(visible)
  return headSlots(
    visible.map((p, i) => ({
      id: p.id,
      name: p.alias ?? p.name,
      typeLabel: participantHead(p.type).typeLabel,
      x: (xFor(i, index) + frame.left) * zoom,
    })),
    frame.total * zoom,
  )
}

/** A participant header box with no colour of its own: a neutral outline. */
const HEADER_COLOUR = '#94a3b8'
/** An activation bar whose participant has no colour of its own: the theme's accent. */
const ACTIVATION_COLOUR = 'var(--accent)'
/** An arrow (or an activation of an unknown participant) with no colour to take: the default green. */
const ARROW_COLOUR = '#34d399'
/** A response arrow with no colour of its own: neutral, so it reads as the reply to its call. */
const RESPONSE_COLOUR = '#94a3b8'
/**
 * A message with no colour of its own whose status is an error (see isErrorStatus, the Errors
 * metric's rule): the theme's error red. The label and inspector still say so in words.
 */
const ERROR_COLOUR = 'var(--error)'

/** Each participant's colour by id, using `fallback` for a participant with none. */
function laneColours(participants: readonly Participant[], fallback: string): Map<string, string> {
  return new Map(participants.map((p) => [p.id, p.colour ?? fallback]))
}

function headerSvg(scenario: Scenario, frame: DiagramFrame, hiddenIds: ReadonlySet<string>, zoom: number): string {
  const width = frame.total
  const visible = visibleParticipants(scenario.participants, hiddenIds)
  const index = laneIndex(visible)
  const boxes = visible
    .map((p, i) => {
      const x = xFor(i, index)
      const name = p.alias ?? p.name
      const head = participantHeadFor(p)
      const colour = escapeAttr(p.colour ?? HEADER_COLOUR)
      return `
      <g class="participant-box" data-participant="${escapeAttr(p.id)}" data-participant-type="${escapeAttr(head.type)}" transform="translate(${x}, 0)" style="--pc:${colour}">
        <title>${escapeHtml(name)}, ${head.typeLabel}</title>
        ${head.shapeSvg}
        ${participantLabelSvg(head, head.name)}
      </g>`
    })
    .join('')
  const summary = visible.map((p) => `${p.alias ?? p.name} ${participantHead(p.type).typeLabel}`).join(', ')
  const dispW = width * zoom
  const dispH = HEADER_BLOCK_H * zoom
  return `<svg class="seq-header-svg" viewBox="${-frame.left} 0 ${width} ${HEADER_BLOCK_H}" width="${dispW}" height="${dispH}" role="img" aria-label="Participants: ${escapeAttr(summary)}">${boxes}</svg>`
}

export function windowSvg(
  diagram: MountedDiagram,
  slice: LayoutRow[],
  view: DiagramView,
  frame: DiagramFrame,
  viewTop: number,
): string {
  const width = frame.base
  const { scenario, rows } = diagram
  const offset = slice[0].y
  const end = slice[slice.length - 1].y + slice[slice.length - 1].height
  const height = Math.max(end - viewTop, 1)
  const visible = visibleParticipants(scenario.participants, view.hidden)
  const index = laneIndex(visible)
  const colourOf = laneColours(scenario.participants, ACTIVATION_COLOUR)
  const spans = activationSpans(rows, Math.max(diagram.height - BOTTOM_PAD, 0))

  const markers = markerSet()
  const ensureMarker = markers.ensure

  const lifelines = visible
    .map((p, i) => {
      const x = xFor(i, index)
      return `<line class="lifeline-line" data-participant="${escapeAttr(p.id)}" x1="${x}" y1="${viewTop}" x2="${x}" y2="${end}" />`
    })
    .join('')

  const actBars = spans
    .map((span) => {
      const i = index.get(span.participantId)
      if (i === undefined) return ''
      const y0 = Math.max(span.y0, offset)
      const y1 = Math.min(span.y1, end)
      if (y1 - y0 < 1) return ''
      const x = xFor(i, index) - ACT_W / 2 + span.depth * ACT_NEST_DX
      const fallback = colourOf.get(span.participantId) ?? ARROW_COLOUR
      return activationBarSvg({
        x,
        y: y0,
        width: ACT_W,
        height: y1 - y0,
        colour: span.colour,
        fallback,
      })
    })
    .join('')

  const paint: RowPaint = {
    query: view.query,
    hiddenIds: view.hidden,
    places: messagePlaces(scenario.events, view.hidden),
    participants: scenario.participants,
    activeMessageId: view.activeMessageId,
    searchCurrentId: view.searchCurrentId ?? null,
    payloadHits: payloadMatches(scenario.id).hits,
    neighbors: focusableNeighbors(rows, view.hidden),
    activations: spans,
    frame,
    minHit: isCoarsePointer() ? TOUCH_HIT_CSS : undefined,
  }
  const buttons: string[] = []
  const body = slice
    .map((row) =>
      renderRow(row, width, index, colourOf, ensureMarker, diagram.labelMaxWidth, paint, buttons, viewTop, view.zoom),
    )
    .join('')
  const dispW = frame.total * view.zoom
  const dispH = height * view.zoom

  return `
  <svg class="seq-svg" viewBox="${-frame.left} ${viewTop} ${frame.total} ${height}" width="${dispW}" height="${dispH}" aria-hidden="true">
    <defs>
      ${ACTIVATION_HATCH}
      ${markers.markup()}
      <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    ${lifelines}
    ${actBars}
    ${body}
  </svg>
  ${buttons.length ? `<div role="group" class="msg-places" aria-label="Open a message payload">${buttons.join('')}</div>` : ''}
`
}

/** Pure SVG fragment for one layout row — used by unit tests and the virtualised window. */
export function renderRowSvg(
  row: LayoutRow,
  width: number,
  participants: Participant[],
  labelMaxWidth: number,
  paint: RowPaint = EMPTY_PAINT,
): string {
  const visible = visibleParticipants(participants, paint.hiddenIds)
  const index = laneIndex(visible)
  const colourOf = laneColours(participants, ARROW_COLOUR)
  const markers = markerSet()
  const ensureMarker = markers.ensure
  const buttons: string[] = []
  const body = renderRow(row, width, index, colourOf, ensureMarker, labelMaxWidth, paint, buttons, row.y, 1)
  return `<svg><defs>${markers.markup()}</defs>${body}</svg>${buttons.join('')}`
}

function renderRow(
  row: LayoutRow,
  width: number,
  index: Map<string, number>,
  colourOf: Map<string, string>,
  ensureMarker: (colour: string, end: ArrowEnd) => string,
  labelMaxWidth: number,
  paint: RowPaint = EMPTY_PAINT,
  buttons: string[] = [],
  viewTop = 0,
  zoom = 1,
): string {
  const event = row.event
  if (eventHiddenByColumns(event, paint.hiddenIds)) return ''
  if (event.kind === 'activate' || event.kind === 'deactivate') return ''

  if (event.kind === 'section') {
    return `
    <g class="section-row" id="section-${escapeAttr(event.id)}" transform="translate(0, ${row.y})">
      <rect class="section-band" x="${12 - (paint.frame?.left ?? 0)}" y="${SECTION_BAND_Y}" width="${Math.max(width + (paint.frame?.left ?? 0) + (paint.frame?.right ?? 0) - 24, 24)}" height="${SECTION_BAND_H}" rx="8"/>
      <text class="section-title" x="${24 - (paint.frame?.left ?? 0)}" y="28">${escapeHtml(event.title)}</text>
    </g>`
  }

  if (event.kind === 'divider') {
    return `
    <g class="divider" transform="translate(0, ${row.y})">
      <line class="divider-line" x1="${LEFT_PAD - 40}" y1="0" x2="${width - LEFT_PAD + 40}" y2="0"/>
      <rect class="divider-pill" x="${width / 2 - 60}" y="-12" width="120" height="24" rx="12"/>
      <text class="divider-label" x="${width / 2}" y="4" text-anchor="middle">${escapeHtml(event.label)}</text>
    </g>`
  }

  if (event.kind === 'delay') {
    const label = event.label?.trim() ? event.label : '…'
    return `
    <g class="delay" transform="translate(0, ${row.y})" data-kind="delay">
      <line class="delay-line" x1="${LEFT_PAD - 40}" y1="0" x2="${width - LEFT_PAD + 40}" y2="0"/>
      <text class="delay-label" x="${width / 2}" y="4" text-anchor="middle">${escapeHtml(label)}</text>
    </g>`
  }

  if (event.kind === 'spacer') {
    return `
    <g class="spacer-row" transform="translate(0, ${row.y})" data-kind="spacer" data-height="${row.height}">
      <line class="spacer-ticks" x1="${LEFT_PAD}" y1="${row.height / 2}" x2="${width - LEFT_PAD}" y2="${row.height / 2}"/>
    </g>`
  }

  if (event.kind === 'note') {
    const layout = noteLayout(event.placement, event.over, index, width)
    const place = layout.placement
    const match = findMatch(event, paint.query)
    const current = match && paint.searchCurrentId === event.id
    const hit = match ? ` search-hit${current ? ' search-current' : ''}` : ''
    const hitAttr = match ? ` data-search-hit="${current ? 'current' : 'match'}"` : ''
    const card = noteCardMetrics(event.text)
    const halfW = card.width / 2
    const halfH = card.height / 2
    // Centre the wrapped lines in the card. Placement is layout only, so the card
    // holds nothing but the note text.
    const firstY = -(card.lines.length * NOTE_LINE_H) / 2 + NOTE_LINE_H * 0.8
    const tspans = card.lines
      .map((line, i) =>
        i === 0
          ? `<tspan x="0" y="${firstY}">${escapeHtml(line)}</tspan>`
          : `<tspan x="0" dy="${NOTE_LINE_H}">${escapeHtml(line)}</tspan>`,
      )
      .join('')
    return `
    <g class="note note-${escapeAttr(place)}${hit}" data-placement="${escapeAttr(place)}"${hitAttr} transform="translate(${layout.x}, ${row.y})">
      <rect class="note-card" x="${-halfW}" y="${-halfH}" width="${card.width}" height="${card.height}" rx="6"/>
      <text class="note-text" text-anchor="${layout.textAnchor}">${tspans}</text>
    </g>`
  }

  return renderMessageRow(
    event as MessageEvent,
    row.y,
    width,
    index,
    colourOf,
    ensureMarker,
    labelMaxWidth,
    paint.query,
    buttons,
    viewTop,
    zoom,
    paint,
  )
}

function messageLabel(msg: MessageEvent, labelMaxWidth: number): string {
  const full = escapeHtml(msg.label)
  const shown = escapeHtml(truncateLabel(msg.label, labelMaxWidth))
  return `<title>${full}</title>${shown}`
}

/**
 * Marks an arrow that has a payload to open. A glyph with a title for sighted users; the arrow's
 * own button already says "Open …" to screen readers, so the glyph is hidden from them.
 */
const PAYLOAD_MARKER =
  '<tspan class="msg-payload" dx="6" aria-hidden="true">{}<title>Has a payload: tap or click the arrow to open it</title></tspan>'

function renderMessageRow(
  msg: MessageEvent,
  y: number,
  width: number,
  index: Map<string, number>,
  colourOf: Map<string, string>,
  ensureMarker: (colour: string, end: ArrowEnd) => string,
  labelMaxWidth: number,
  query: string,
  buttons: string[],
  viewTop: number,
  zoom: number,
  paint: RowPaint,
): string {
  const spec = messageArrowSpec(msg.type)
  const match = findMatch(msg, query, paint.payloadHits)
  const rawColour =
    msg.colour ||
    (msg.status && isErrorStatus(msg.status) ? ERROR_COLOUR : null) ||
    (msg.type === 'SYNCHRONOUS_RESPONSE' ? RESPONSE_COLOUR : colourOf.get(msg.from || msg.to) || ARROW_COLOUR)
  const endId = ensureMarker(rawColour, spec.end)
  const startId = ensureMarker(rawColour, spec.start)
  const colour = escapeAttr(rawColour)
  const dashed = spec.dashed ? 'stroke-dasharray="5 4"' : ''
  const markerEnd = endId ? `marker-end="url(#${escapeAttr(endId)})"` : ''
  const markerStart = startId ? `marker-start="url(#${escapeAttr(startId)})"` : ''
  const hasData = messageHasPayload(msg)
  const dur = msg.durationMs != null ? `<tspan class="msg-dur"> · ${escapeHtml(msg.durationMs)}ms</tspan>` : ''
  const payload = hasData ? PAYLOAD_MARKER : ''
  const cue = spec.typeCue ? `<tspan class="msg-type-cue"> [${escapeHtml(spec.typeCue)}]</tspan>` : ''
  const current = match !== null && paint.searchCurrentId === msg.id
  const hitClass = match ? ` search-hit${current ? ' search-current' : ''}${matchClasses(match)}` : ''
  const hitAttr = match ? ` data-search-hit="${current ? 'current' : 'match'}" data-search-in="${match}"` : ''
  const typeAttr = `data-msg-type="${escapeAttr(msg.type)}"`
  if (hasData) buttons.push(messageOpenButton(msg, y, width, index, viewTop, zoom, paint))

  // Nested bars sit ACT_NEST_DX right of their parent, so arrows shift with them.
  const nest = (participantId: string, at: number) =>
    Math.max(activationDepthAt(paint.activations ?? [], participantId, at), 0) * ACT_NEST_DX

  if (isShortMessage(msg.type)) {
    const participantId = msg.type === 'SHORT_INBOUND' ? msg.to : msg.from
    const pi = index.get(participantId) ?? 0
    const px = xFor(pi, index) + nest(participantId, y)
    const { x1, x2 } = shortMessageEndpoints(msg.type, px, width)
    // The label runs away from the lifeline, so it never sits on the bar.
    const label = shortLabelAnchor(msg.type, x1, x2)
    const hitX = (x1 + x2) / 2
    return `
    <g class="message message-short${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} transform="translate(0, ${y})" style="--pc:${colour}">
      <line class="msg-path" x1="${x1}" y1="0" x2="${x2}" y2="0" stroke="${colour}" stroke-width="2" ${markerEnd} ${dashed}/>
      <text class="msg-label" x="${label.x}" y="-8" text-anchor="${label.anchor}">${messageLabel(msg, labelMaxWidth)}${cue}${dur}${payload}</text>
      ${hasData ? `<circle class="msg-hit" cx="${hitX}" cy="0" r="16"/>` : ''}
    </g>`
  }

  const fi = index.get(msg.from) ?? 0
  const ti = index.get(msg.to) ?? 0
  const x1 = xFor(fi, index)
  const x2 = xFor(ti, index)
  const self = fi === ti && msg.from === msg.to

  if (self) {
    // Leaves the bar in use at the row and comes back to the innermost bar at the return.
    // A bar opened by this call starts at the return, one level deeper, so the
    // arrowhead lands on its edge.
    const out = x1 + ACT_W + nest(msg.from, y)
    const back =
      x1 +
      ACT_W +
      Math.max(
        activationDepthAt(paint.activations ?? [], msg.from, y + SELF_RETURN_DY) - 1,
        activationDepthAt(paint.activations ?? [], msg.from, y),
        0,
      ) *
        ACT_NEST_DX
    const bend = Math.max(out, back) + 48 - ACT_W
    return `
    <g class="message${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} transform="translate(0, ${y})" style="--pc:${colour}">
      <path class="msg-path" d="M${out} 0 C${bend} 0, ${bend} ${SELF_RETURN_DY}, ${back} ${SELF_RETURN_DY}" fill="none" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
      <text class="msg-label" x="${bend + 8}" y="4">${messageLabel(msg, labelMaxWidth)}${cue}${dur}${payload}</text>
      ${hasData ? `<circle class="msg-hit" cx="${bend - 8}" cy="11" r="14"/>` : ''}
    </g>`
  }

  const labelX = (x1 + x2) / 2
  const lineX1 = x1 + (x2 > x1 ? ACT_W / 2 : -ACT_W / 2) + nest(msg.from, y)
  const lineX2 = x2 + (x2 > x1 ? -ACT_W / 2 : ACT_W / 2) + nest(msg.to, y)
  return `
  <g class="message${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} transform="translate(0, ${y})" style="--pc:${colour}">
    <line class="msg-path" x1="${lineX1}" y1="0" x2="${lineX2}" y2="0" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
    <text class="msg-label" x="${labelX}" y="-8" text-anchor="middle">${messageLabel(msg, labelMaxWidth)}${cue}${dur}${payload}</text>
    ${hasData ? `<circle class="msg-hit" cx="${labelX}" cy="0" r="16"/>` : ''}
  </g>`
}

/**
 * Real button over the arrow and its label. The SVG itself is aria-hidden,
 * so a role on the line would be skipped by screen readers.
 */
/** Which parts of an arrow Find bands: the label, the {} marker, or both. */
function matchClasses(match: FindMatch): string {
  if (match === 'both') return ' search-in-label search-in-payload'
  return match === 'label' ? ' search-in-label' : ' search-in-payload'
}

const MATCH_PLACE: Record<FindMatch, string> = { label: '', payload: ' in payload', both: ' in label and payload' }

/** Spoken in place of the highlight: the SVG is hidden from assistive tech, its buttons are not. The full message list is the text view. */
function searchCue(msg: MessageEvent, paint: RowPaint): string {
  const match = findMatch(msg, paint.query, paint.payloadHits)
  if (!match) return ''
  const what = paint.searchCurrentId === msg.id ? 'current search match' : 'search match'
  return `, ${what}${MATCH_PLACE[match]}`
}

function messageOpenButton(
  msg: MessageEvent,
  y: number,
  width: number,
  index: Map<string, number>,
  viewTop: number,
  zoom: number,
  paint: RowPaint,
): string {
  const ends = messageEndpoints(msg, index, width)
  const rect = messageLabelRect({ arrowY: y, x1: ends.x1, x2: ends.x2 })
  // The overlay starts at the drawn left edge, frame.left left of x = 0.
  const label = { ...rect, x: rect.x + (paint.frame?.left ?? 0) }
  const neighbor = paint.neighbors?.get(msg.id)
  const box = messageHitBox({
    label,
    zoom,
    viewTop,
    prevArrowY: neighbor?.prevArrowY,
    nextArrowY: neighbor?.nextArrowY,
    minSize: paint.minHit,
  })
  const places = paint.places ?? [{ id: msg.id, posinset: 1, setsize: 1, focusable: true }]
  const tab = tabindexFor(msg.id, paint.activeMessageId ?? null, places)
  return `<div class="msg-place"><button type="button" class="msg-open" data-message-id="${escapeAttr(msg.id)}" aria-label="${escapeAttr(`Open ${messageSpeech(msg, paint.participants ?? [], true)}${searchCue(msg, paint)}`)}" tabindex="${tab}" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px"></button></div>`
}
