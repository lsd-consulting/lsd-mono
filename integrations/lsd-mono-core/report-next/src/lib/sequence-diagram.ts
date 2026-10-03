import type {
  ActivateEvent,
  DiagramEvent,
  MessageEvent,
  MessageType,
  NoteEvent,
  NotePlacement,
  Participant,
  Scenario,
} from '../types'
import {
  ACT_W,
  BOTTOM_PAD,
  COL_GAP,
  DEFAULT_OVERSCAN,
  DEFAULT_VIEWPORT,
  EDGE_INSET,
  HEADER_BLOCK_H,
  LEFT_PAD,
  SHORT_STUB,
  activationSpans,
  bodyHeight,
  diagramWidth,
  layoutRows,
  virtualRowRange,
  type LayoutRow,
} from './layout'

export interface MountedDiagram {
  scenario: Scenario
  rows: LayoutRow[]
  width: number
  height: number
}

export type ArrowEnd = 'filled' | 'open' | 'lost' | 'none'

export interface MessageArrowSpec {
  /** Non-colour cue: dashed stroke for async / response. */
  dashed: boolean
  start: ArrowEnd
  end: ArrowEnd
  /** Accessible / visible type cue shown next to the label when shape alone may be subtle. */
  typeCue: string | null
}

const mounted = new Map<string, MountedDiagram>()

function xFor(index: number): number {
  return LEFT_PAD + index * COL_GAP
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function participantIcon(type: Participant['type']): string {
  switch (type) {
    case 'ACTOR':
      return '●'
    case 'DATABASE':
      return '▣'
    case 'QUEUE':
      return '☰'
    case 'BOUNDARY':
      return '◇'
    default:
      return '▢'
  }
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
  if (end === 'open') {
    return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M1 1 L9 5 L1 9" fill="none" stroke="${colour}" stroke-width="1.6"/>
    </marker>`
  }
  if (end === 'lost') {
    // X tip — shape cue distinct from a filled sync arrow (not colour-only).
    return `<marker id="${id}" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M2 2 L10 10 M10 2 L2 10" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round"/>
    </marker>`
  }
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="${colour}"/>
  </marker>`
}

/**
 * Geometry for short arrows: stub toward the diagram edge from the real lifeline.
 * Does not invent a phantom participant column.
 */
export function shortMessageEndpoints(
  type: 'SHORT_INBOUND' | 'SHORT_OUTBOUND',
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
  const px = over ? xFor(i) : width / 2
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

export function mountDiagram(scenario: Scenario): MountedDiagram {
  const rows = layoutRows(scenario.events)
  const diagram: MountedDiagram = {
    scenario,
    rows,
    width: diagramWidth(scenario.participants.length),
    height: bodyHeight(rows),
  }
  mounted.set(scenario.id, diagram)
  return diagram
}

/** Continuous diagram: sticky participant header, section jump list, virtualised rows. */
export function renderDiagramHtml(scenario: Scenario): string {
  const diagram = mountDiagram(scenario)
  const sections = diagram.rows.filter((row) => row.event.kind === 'section')
  const jump = sections.length
    ? `<nav class="section-jump" aria-label="Diagram sections">${sections
        .map((row) => {
          const title = row.event.kind === 'section' ? row.event.title : ''
          return `<button type="button" data-jump-y="${row.y}">${escapeXml(title)}</button>`
        })
        .join('')}</nav>`
    : ''
  return `
    <div class="seq-diagram">
      ${jump}
      <div class="seq-scroll" data-scenario-id="${escapeXml(scenario.id)}" tabindex="0" aria-label="Sequence diagram for ${escapeXml(scenario.title)}">
        <div class="seq-sticky-header" style="width:${diagram.width}px">${headerSvg(scenario, diagram.width)}</div>
        <div class="seq-spacer" style="height:${diagram.height}px;width:${diagram.width}px">
          <div class="seq-window"></div>
        </div>
      </div>
    </div>`
}

/** Paint only the rows inside the scrollport (plus overscan). 1 SVG unit = 1 CSS pixel. */
export function syncDiagramWindow(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = mounted.get(id)
  if (!diagram) return
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
  const headerHeight = header?.offsetHeight || HEADER_BLOCK_H
  const viewportHeight = scrollport.clientHeight || DEFAULT_VIEWPORT
  const range = virtualRowRange({
    rows: diagram.rows,
    scrollTop: scrollport.scrollTop,
    viewportHeight,
    headerHeight,
    overscan: DEFAULT_OVERSCAN,
  })
  const slice = diagram.rows.slice(range.start, range.end)
  const windowEl = scrollport.querySelector<HTMLElement>('.seq-window')
  if (!windowEl) return
  const offset = slice[0]?.y ?? 0
  windowEl.style.transform = `translateY(${offset}px)`
  windowEl.innerHTML = slice.length ? windowSvg(diagram, slice) : ''
}

export function bindDiagramScroll(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => {
    syncDiagramWindow(el)
    el.addEventListener('scroll', () => syncDiagramWindow(el), { passive: true })
  })
}

function headerSvg(scenario: Scenario, width: number): string {
  const boxes = scenario.participants
    .map((p, i) => {
      const x = xFor(i)
      const c = p.colour ?? '#94a3b8'
      return `
      <g class="participant-box" data-participant="${escapeXml(p.id)}" transform="translate(${x}, ${HEADER_BLOCK_H / 2})">
        <rect class="participant-card" x="-54" y="-18" width="108" height="36" rx="10" style="--pc:${c}"/>
        <text class="participant-icon" y="-2" text-anchor="middle">${participantIcon(p.type)}</text>
        <text class="participant-label" y="12" text-anchor="middle">${escapeXml(p.alias ?? p.name)}</text>
      </g>`
    })
    .join('')
  return `<svg class="seq-header-svg" viewBox="0 0 ${width} ${HEADER_BLOCK_H}" width="${width}" height="${HEADER_BLOCK_H}" role="img" aria-label="Participants">${boxes}</svg>`
}

function windowSvg(diagram: MountedDiagram, slice: LayoutRow[]): string {
  const { scenario, rows, width } = diagram
  const offset = slice[0].y
  const end = slice[slice.length - 1].y + slice[slice.length - 1].height
  const height = Math.max(end - offset, 1)
  const index = new Map(scenario.participants.map((p, i) => [p.id, i]))
  const colourOf = new Map(scenario.participants.map((p) => [p.id, p.colour ?? 'var(--accent)']))
  const spans = activationSpans(rows, Math.max(diagram.height - BOTTOM_PAD, 0))

  const markers: string[] = []
  const markerIds = new Set<string>()
  const ensureMarker = (colour: string, end: ArrowEnd) => {
    if (end === 'none') return ''
    const key = `${end}_${colour.replace('#', '')}`
    if (!markerIds.has(key)) {
      markerIds.add(key)
      markers.push(arrowMarker(`mk_${key}`, colour, end))
    }
    return `mk_${key}`
  }

  const lifelines = scenario.participants
    .map((p, i) => {
      const x = xFor(i)
      return `<line class="lifeline-line" data-participant="${escapeXml(p.id)}" x1="${x}" y1="${offset}" x2="${x}" y2="${end}" />`
    })
    .join('')

  const actBars = spans
    .map((span) => {
      const i = index.get(span.participantId)
      if (i === undefined) return ''
      const y0 = Math.max(span.y0, offset)
      const y1 = Math.min(span.y1, end)
      if (y1 - y0 < 1) return ''
      const x = xFor(i) - ACT_W / 2
      const c = colourOf.get(span.participantId) ?? '#34d399'
      return `<rect class="activation" x="${x}" y="${y0}" width="${ACT_W}" height="${y1 - y0}" rx="3" style="--pc:${c}"/>`
    })
    .join('')

  const body = slice.map((row) => renderRow(row, width, index, colourOf, ensureMarker)).join('')

  return `
  <svg class="seq-svg" viewBox="0 ${offset} ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <defs>
      ${markers.join('\n')}
      <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    ${lifelines}
    ${actBars}
    ${body}
  </svg>`
}

/** Pure SVG fragment for one layout row — used by unit tests and the virtualised window. */
export function renderRowSvg(
  row: LayoutRow,
  width: number,
  participants: Participant[],
): string {
  const index = new Map(participants.map((p, i) => [p.id, i]))
  const colourOf = new Map(participants.map((p) => [p.id, p.colour ?? '#34d399']))
  const markers: string[] = []
  const markerIds = new Set<string>()
  const ensureMarker = (colour: string, end: ArrowEnd) => {
    if (end === 'none') return ''
    const key = `${end}_${colour.replace('#', '')}`
    if (!markerIds.has(key)) {
      markerIds.add(key)
      markers.push(arrowMarker(`mk_${key}`, colour, end))
    }
    return `mk_${key}`
  }
  const body = renderRow(row, width, index, colourOf, ensureMarker)
  return `<svg><defs>${markers.join('')}</defs>${body}</svg>`
}

function renderRow(
  row: LayoutRow,
  width: number,
  index: Map<string, number>,
  colourOf: Map<string, string>,
  ensureMarker: (colour: string, end: ArrowEnd) => string,
): string {
  const event = row.event
  if (event.kind === 'activate' || event.kind === 'deactivate') return ''

  if (event.kind === 'section') {
    return `
    <g class="section-row" id="section-${escapeXml(event.id)}" transform="translate(0, ${row.y})">
      <rect class="section-band" x="12" y="8" width="${Math.max(width - 24, 24)}" height="${row.height - 16}" rx="8"/>
      <text class="section-title" x="24" y="28">${escapeXml(event.title)}</text>
    </g>`
  }

  if (event.kind === 'divider') {
    return `
    <g class="divider" transform="translate(0, ${row.y})">
      <line class="divider-line" x1="${LEFT_PAD - 40}" y1="0" x2="${width - LEFT_PAD + 40}" y2="0"/>
      <rect class="divider-pill" x="${width / 2 - 60}" y="-12" width="120" height="24" rx="12"/>
      <text class="divider-label" x="${width / 2}" y="4" text-anchor="middle">${escapeXml(event.label)}</text>
    </g>`
  }

  if (event.kind === 'delay') {
    const label = event.label?.trim() ? event.label : '…'
    return `
    <g class="delay" transform="translate(0, ${row.y})" data-kind="delay">
      <line class="delay-line" x1="${LEFT_PAD - 40}" y1="0" x2="${width - LEFT_PAD + 40}" y2="0"/>
      <text class="delay-label" x="${width / 2}" y="4" text-anchor="middle">${escapeXml(label)}</text>
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
    return `
    <g class="note note-${place}" data-placement="${place}" transform="translate(${layout.x}, ${row.y})">
      <rect class="note-card" x="-70" y="-14" width="140" height="28" rx="6"/>
      <text class="note-text" y="4" text-anchor="${layout.textAnchor}">${escapeXml(event.text)}</text>
      <text class="note-place-cue" x="0" y="18" text-anchor="middle">${place}</text>
    </g>`
  }

  return renderMessageRow(event as MessageEvent, row.y, width, index, colourOf, ensureMarker)
}

function renderMessageRow(
  msg: MessageEvent,
  y: number,
  width: number,
  index: Map<string, number>,
  colourOf: Map<string, string>,
  ensureMarker: (colour: string, end: ArrowEnd) => string,
): string {
  const spec = messageArrowSpec(msg.type)
  const colour =
    msg.colour ||
    (msg.type === 'SYNCHRONOUS_RESPONSE'
      ? '#94a3b8'
      : colourOf.get(msg.from || msg.to) || '#34d399')
  const endId = ensureMarker(colour, spec.end)
  const startId = ensureMarker(colour, spec.start)
  const dashed = spec.dashed ? 'stroke-dasharray="5 4"' : ''
  const markerEnd = endId ? `marker-end="url(#${endId})"` : ''
  const markerStart = startId ? `marker-start="url(#${startId})"` : ''
  const hasData = msg.data !== undefined && msg.data !== null
  const dur = msg.durationMs != null ? `<tspan class="msg-dur"> · ${msg.durationMs}ms</tspan>` : ''
  const cue = spec.typeCue
    ? `<tspan class="msg-type-cue"> [${escapeXml(spec.typeCue)}]</tspan>`
    : ''
  const clickable = hasData
    ? `data-message-id="${escapeXml(msg.id)}" tabindex="0" role="button" aria-label="Open ${escapeXml(msg.label)}"`
    : ''
  const typeAttr = `data-msg-type="${escapeXml(msg.type)}"`

  if (msg.type === 'SHORT_INBOUND' || msg.type === 'SHORT_OUTBOUND') {
    const participantId = msg.type === 'SHORT_INBOUND' ? msg.to : msg.from
    const pi = index.get(participantId) ?? 0
    const px = xFor(pi)
    const { x1, x2 } = shortMessageEndpoints(msg.type, px, width)
    const labelX = (x1 + x2) / 2
    return `
    <g class="message message-short${hasData ? ' has-data' : ''}" ${typeAttr} ${clickable} transform="translate(0, ${y})">
      <line class="msg-path" x1="${x1}" y1="0" x2="${x2}" y2="0" stroke="${colour}" stroke-width="2" ${markerEnd} ${dashed}/>
      <text class="msg-label" x="${labelX}" y="-8" text-anchor="middle">${escapeXml(msg.label)}${cue}${dur}</text>
      ${hasData ? `<circle class="msg-hit" cx="${labelX}" cy="0" r="16"/>` : ''}
    </g>`
  }

  const fi = index.get(msg.from) ?? 0
  const ti = index.get(msg.to) ?? 0
  const x1 = xFor(fi)
  const x2 = xFor(ti)
  const self = fi === ti && msg.from === msg.to

  if (self) {
    return `
    <g class="message${hasData ? ' has-data' : ''}" ${typeAttr} ${clickable} transform="translate(0, ${y})">
      <path class="msg-path" d="M${x1 + ACT_W} 0 C${x1 + 48} 0, ${x1 + 48} 22, ${x1 + ACT_W} 22" fill="none" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
      <text class="msg-label" x="${x1 + 56}" y="4">${escapeXml(msg.label)}${cue}${dur}</text>
      ${hasData ? `<circle class="msg-hit" cx="${x1 + 40}" cy="11" r="14"/>` : ''}
    </g>`
  }

  const labelX = (x1 + x2) / 2
  const lineX1 = x1 + (x2 > x1 ? ACT_W / 2 : -ACT_W / 2)
  const lineX2 = x2 + (x2 > x1 ? -ACT_W / 2 : ACT_W / 2)
  return `
  <g class="message${hasData ? ' has-data' : ''}" ${typeAttr} ${clickable} transform="translate(0, ${y})">
    <line class="msg-path" x1="${lineX1}" y1="0" x2="${lineX2}" y2="0" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
    <text class="msg-label" x="${labelX}" y="-8" text-anchor="middle">${escapeXml(msg.label)}${cue}${dur}</text>
    ${hasData ? `<circle class="msg-hit" cx="${labelX}" cy="0" r="16"/>` : ''}
  </g>`
}

export function findMessage(scenario: Scenario, messageId: string): MessageEvent | undefined {
  return scenario.events.find((e): e is MessageEvent => e.kind === 'message' && e.id === messageId)
}

export function findNote(scenario: Scenario, noteId: string): NoteEvent | undefined {
  return scenario.events.find((e): e is NoteEvent => e.kind === 'note' && e.id === noteId)
}

export function isActivate(e: DiagramEvent): e is ActivateEvent {
  return e.kind === 'activate' || e.kind === 'deactivate'
}
