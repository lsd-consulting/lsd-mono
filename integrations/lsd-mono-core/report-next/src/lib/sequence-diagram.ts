import type { ActivateEvent, DiagramEvent, MessageEvent, NoteEvent, Participant, Scenario } from '../types'
import {
  ACT_W,
  BOTTOM_PAD,
  COL_GAP,
  DEFAULT_OVERSCAN,
  DEFAULT_VIEWPORT,
  HEADER_BLOCK_H,
  LEFT_PAD,
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

function arrowMarker(id: string, colour: string, open = false): string {
  if (open) {
    return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M1 1 L9 5 L1 9" fill="none" stroke="${colour}" stroke-width="1.6"/>
    </marker>`
  }
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="${colour}"/>
  </marker>`
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
  const ensureMarker = (colour: string, open: boolean) => {
    const key = `${open ? 'o' : 'f'}_${colour.replace('#', '')}`
    if (!markerIds.has(key)) {
      markerIds.add(key)
      markers.push(arrowMarker(`mk_${key}`, colour, open))
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

  const body = slice
    .map((row) => renderRow(row, width, index, colourOf, ensureMarker))
    .join('')

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

function renderRow(
  row: LayoutRow,
  width: number,
  index: Map<string, number>,
  colourOf: Map<string, string>,
  ensureMarker: (colour: string, open: boolean) => string,
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

  if (event.kind === 'note') {
    const i = index.get(event.over) ?? 0
    const x = xFor(i)
    return `
    <g class="note" transform="translate(${x}, ${row.y})">
      <rect class="note-card" x="-70" y="-14" width="140" height="28" rx="6"/>
      <text class="note-text" y="4" text-anchor="middle">${escapeXml(event.text)}</text>
    </g>`
  }

  const msg = event as MessageEvent
  const fi = index.get(msg.from) ?? 0
  const ti = index.get(msg.to) ?? 0
  const x1 = xFor(fi)
  const x2 = xFor(ti)
  const self = fi === ti
  const colour =
    msg.colour || (msg.type === 'SYNCHRONOUS_RESPONSE' ? '#94a3b8' : colourOf.get(msg.from) || '#34d399')
  const dashed = msg.type === 'ASYNCHRONOUS' || msg.type === 'SYNCHRONOUS_RESPONSE'
  const openArrow = msg.type === 'ASYNCHRONOUS'
  const mid = ensureMarker(colour, openArrow)
  const hasData = msg.data !== undefined && msg.data !== null
  const dur = msg.durationMs != null ? `<tspan class="msg-dur"> · ${msg.durationMs}ms</tspan>` : ''
  const clickable = hasData
    ? `data-message-id="${escapeXml(msg.id)}" tabindex="0" role="button" aria-label="Open ${escapeXml(msg.label)}"`
    : ''

  if (self) {
    return `
    <g class="message${hasData ? ' has-data' : ''}" ${clickable} transform="translate(0, ${row.y})">
      <path class="msg-path" d="M${x1 + ACT_W} 0 C${x1 + 48} 0, ${x1 + 48} 22, ${x1 + ACT_W} 22" fill="none" stroke="${colour}" stroke-width="2" marker-end="url(#${mid})" ${dashed ? 'stroke-dasharray="5 4"' : ''}/>
      <text class="msg-label" x="${x1 + 56}" y="4">${escapeXml(msg.label)}${dur}</text>
      ${hasData ? `<circle class="msg-hit" cx="${x1 + 40}" cy="11" r="14"/>` : ''}
    </g>`
  }

  const labelX = (x1 + x2) / 2
  return `
  <g class="message${hasData ? ' has-data' : ''}" ${clickable} transform="translate(0, ${row.y})">
    <line class="msg-path" x1="${x1 + (x2 > x1 ? ACT_W / 2 : -ACT_W / 2)}" y1="0" x2="${x2 + (x2 > x1 ? -ACT_W / 2 : ACT_W / 2)}" y2="0" stroke="${colour}" stroke-width="2" marker-end="url(#${mid})" ${dashed ? 'stroke-dasharray="5 4"' : ''}/>
    <text class="msg-label" x="${labelX}" y="-8" text-anchor="middle">${escapeXml(msg.label)}${dur}</text>
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

