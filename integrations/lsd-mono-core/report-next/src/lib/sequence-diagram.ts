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
import { DEFAULT_LABEL_MAX_WIDTH, truncateLabel } from '../ui/format'
import {
  DEFAULT_ZOOM,
  classifySearchHits,
  eventHiddenByColumns,
  fitToWidthScale,
  rowMatchesQuery,
  searchCountLabel,
  stepZoom,
  unscaledViewport,
  visibleParticipants,
  zoomFromWheel,
  zoomLabel,
} from './diagram-view'

export interface MountedDiagram {
  scenario: Scenario
  rows: LayoutRow[]
  width: number
  height: number
  labelMaxWidth: number
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

export interface DiagramView {
  zoom: number
  hidden: Set<string>
  query: string
}

export interface RowPaint {
  query: string
  hiddenIds: ReadonlySet<string>
}

const views = new Map<string, DiagramView>()
const EMPTY_PAINT: RowPaint = { query: '', hiddenIds: new Set() }

export function diagramView(scenarioId: string): DiagramView {
  let view = views.get(scenarioId)
  if (!view) {
    view = { zoom: DEFAULT_ZOOM, hidden: new Set(), query: '' }
    views.set(scenarioId, view)
  }
  return view
}

function logicalWidth(scenario: Scenario, hiddenIds: ReadonlySet<string>): number {
  return diagramWidth(visibleParticipants(scenario.participants, hiddenIds).length)
}

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

/** Diagonal hatch so a coloured activation is not colour-only (colour blindness). */
export const ACTIVATION_HATCH =
  '<pattern id="act-tint-hatch" patternUnits="userSpaceOnUse" width="6" height="6"><path d="M0 6 L6 0" fill="none" stroke="#111" stroke-width="1.2"/></pattern>'

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
    return `<rect class="activation" x="${x}" y="${y}" width="${width}" height="${height}" rx="3" style="--pc:${args.fallback}"/>`
  }
  const colour = escapeXml(args.colour)
  return `<g class="activation-coloured" role="img" aria-label="coloured activation"><title>coloured activation</title><rect class="activation" x="${x}" y="${y}" width="${width}" height="${height}" rx="3" style="--pc:${colour}"/><rect class="activation-hatch" x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#act-tint-hatch)"/></g>`
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

export function mountDiagram(scenario: Scenario, labelMaxWidth = DEFAULT_LABEL_MAX_WIDTH): MountedDiagram {
  const rows = layoutRows(scenario.events)
  const diagram: MountedDiagram = {
    scenario,
    rows,
    width: diagramWidth(scenario.participants.length),
    height: bodyHeight(rows),
    labelMaxWidth,
  }
  mounted.set(scenario.id, diagram)
  return diagram
}

function toolbarHtml(scenario: Scenario, view: DiagramView): string {
  const hits = classifySearchHits(scenario.events, view.query, view.hidden)
  const toggles = scenario.participants
    .map((p) => {
      const shown = !view.hidden.has(p.id)
      const name = p.alias ?? p.name
      const cue = shown ? 'shown' : 'hidden'
      return `<button type="button" data-participant-toggle="${escapeXml(p.id)}" aria-pressed="${shown}" aria-label="${shown ? 'Hide' : 'Show'} ${escapeXml(name)}"><span class="vis-cue">${cue}</span> ${escapeXml(name)}</button>`
    })
    .join('')
  return `
    <div class="seq-toolbar" role="toolbar" aria-label="Diagram view">
      <div class="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" data-zoom="out" aria-label="Zoom out">Out</button>
        <button type="button" data-zoom="fit" aria-label="Fit to width">Fit</button>
        <span class="zoom-readout" aria-live="polite">${zoomLabel(view.zoom)}</span>
        <button type="button" data-zoom="in" aria-label="Zoom in">In</button>
      </div>
      <div class="participant-toggles" role="group" aria-label="Show or hide participants">${toggles}</div>
      <label class="diagram-find">
        <span class="diagram-find-label">Find</span>
        <input type="search" data-diagram-find value="${escapeXml(view.query)}" placeholder="Messages and notes" aria-label="Find messages and notes in this diagram" autocomplete="off"/>
        <span class="diagram-find-count" aria-live="polite">${escapeXml(searchCountLabel(hits.total, hits.hidden, view.query))}</span>
      </label>
    </div>`
}

/** Continuous diagram: sticky participant header, section jump list, virtualised rows. */
export function renderDiagramHtml(scenario: Scenario, labelMaxWidth = DEFAULT_LABEL_MAX_WIDTH): string {
  const diagram = mountDiagram(scenario, labelMaxWidth)
  const view = diagramView(scenario.id)
  const width = logicalWidth(scenario, view.hidden)
  const zoom = view.zoom
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
      ${toolbarHtml(scenario, view)}
      <div class="seq-scroll" data-scenario-id="${escapeXml(scenario.id)}" tabindex="0" aria-label="Sequence diagram for ${escapeXml(scenario.title)}">
        <div class="seq-sticky-header" style="width:${width * zoom}px">${headerSvg(scenario, width, view.hidden, zoom)}</div>
        <div class="seq-spacer" style="height:${diagram.height * zoom}px;width:${width * zoom}px">
          <div class="seq-window"></div>
        </div>
      </div>
    </div>`
}

/** When true, paint every row so print is not clipped to the virtual window. */
let printAllRows = false

/** Paint only the rows inside the scrollport (plus overscan). Row units stay unscaled; zoom is display-only. */
export function syncDiagramWindow(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = mounted.get(id)
  if (!diagram) return
  const view = diagramView(id)
  const zoom = view.zoom
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
  const cssHeader = header?.offsetHeight || HEADER_BLOCK_H * zoom
  const cssViewport = scrollport.clientHeight || DEFAULT_VIEWPORT
  const unscaled = unscaledViewport({
    scrollTop: scrollport.scrollTop,
    viewportHeight: cssViewport,
    headerHeight: cssHeader,
    zoom,
  })
  const range = printAllRows
    ? { start: 0, end: diagram.rows.length }
    : virtualRowRange({
        rows: diagram.rows,
        scrollTop: unscaled.scrollTop,
        viewportHeight: unscaled.viewportHeight,
        headerHeight: unscaled.headerHeight,
        overscan: DEFAULT_OVERSCAN,
      })
  const slice = diagram.rows.slice(range.start, range.end)
  const windowEl = scrollport.querySelector<HTMLElement>('.seq-window')
  if (!windowEl) return
  const offset = slice[0]?.y ?? 0
  windowEl.style.transform = `translateY(${offset * zoom}px)`
  const width = logicalWidth(diagram.scenario, view.hidden)
  windowEl.innerHTML = slice.length ? windowSvg(diagram, slice, view, width) : ''
}

/** Resize the sticky header and body to the current zoom and visible columns. */
export function applyDiagramFrame(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = mounted.get(id)
  if (!diagram) return
  const view = diagramView(id)
  const width = logicalWidth(diagram.scenario, view.hidden)
  const zoom = view.zoom
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
  if (header) {
    header.style.width = `${width * zoom}px`
    header.innerHTML = headerSvg(diagram.scenario, width, view.hidden, zoom)
  }
  const spacer = scrollport.querySelector<HTMLElement>('.seq-spacer')
  if (spacer) {
    spacer.style.height = `${diagram.height * zoom}px`
    spacer.style.width = `${width * zoom}px`
  }
  const root = scrollport.closest('.seq-diagram')
  if (!root) return
  const readout = root.querySelector('.zoom-readout')
  if (readout) readout.textContent = zoomLabel(zoom)
  root.querySelectorAll<HTMLButtonElement>('[data-participant-toggle]').forEach((btn) => {
    const participantId = btn.dataset.participantToggle ?? ''
    const shown = !view.hidden.has(participantId)
    btn.setAttribute('aria-pressed', String(shown))
    const cue = btn.querySelector('.vis-cue')
    if (cue) cue.textContent = shown ? 'shown' : 'hidden'
    const labelName = Array.from(btn.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim()
    btn.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} ${labelName}`)
  })
  const count = root.querySelector('.diagram-find-count')
  if (count) {
    const hits = classifySearchHits(diagram.scenario.events, view.query, view.hidden)
    count.textContent = searchCountLabel(hits.total, hits.hidden, view.query)
  }
}

function commitZoom(scrollport: HTMLElement, next: number): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const view = diagramView(id)
  const prev = view.zoom || 1
  const ratio = next / prev
  view.zoom = next
  applyDiagramFrame(scrollport)
  scrollport.scrollTop *= ratio
  scrollport.scrollLeft *= ratio
  syncDiagramWindow(scrollport)
}

function onDiagramWheel(scrollport: HTMLElement, ev: WheelEvent): void {
  if (!ev.ctrlKey && !ev.metaKey) return
  ev.preventDefault()
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const view = diagramView(id)
  const next = zoomFromWheel(view.zoom, ev.deltaY)
  if (next === view.zoom) return
  commitZoom(scrollport, next)
}

function onZoomClick(scrollport: HTMLElement, action: string | undefined): void {
  const id = scrollport.dataset.scenarioId
  if (!id || !action) return
  const diagram = mounted.get(id)
  if (!diagram) return
  const view = diagramView(id)
  let next = view.zoom
  if (action === 'in') next = stepZoom(view.zoom, 1)
  else if (action === 'out') next = stepZoom(view.zoom, -1)
  else if (action === 'fit') next = fitToWidthScale(logicalWidth(diagram.scenario, view.hidden), scrollport.clientWidth)
  else return
  commitZoom(scrollport, next)
}

function onToggleParticipant(scrollport: HTMLElement, participantId: string): void {
  const id = scrollport.dataset.scenarioId
  if (!id || !participantId) return
  const view = diagramView(id)
  if (view.hidden.has(participantId)) view.hidden.delete(participantId)
  else view.hidden.add(participantId)
  applyDiagramFrame(scrollport)
  syncDiagramWindow(scrollport)
}

let printHooks = false

function ensurePrintHooks(): void {
  if (printHooks || typeof window === 'undefined') return
  printHooks = true
  const repaint = () => {
    document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => syncDiagramWindow(el))
  }
  window.addEventListener('beforeprint', () => {
    printAllRows = true
    repaint()
  })
  window.addEventListener('afterprint', () => {
    printAllRows = false
    repaint()
  })
}

export function bindDiagramScroll(root: ParentNode): void {
  ensurePrintHooks()
  root.querySelectorAll<HTMLElement>('.seq-diagram').forEach((diagram) => {
    const scroll = diagram.querySelector<HTMLElement>('.seq-scroll')
    if (!scroll?.dataset.scenarioId) return
    const id = scroll.dataset.scenarioId
    applyDiagramFrame(scroll)
    syncDiagramWindow(scroll)
    scroll.addEventListener('scroll', () => syncDiagramWindow(scroll), { passive: true })
    scroll.addEventListener('wheel', (ev) => onDiagramWheel(scroll, ev), { passive: false })
    diagram.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((btn) => {
      btn.addEventListener('click', () => onZoomClick(scroll, btn.dataset.zoom))
    })
    diagram.querySelectorAll<HTMLButtonElement>('[data-participant-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => onToggleParticipant(scroll, btn.dataset.participantToggle ?? ''))
    })
    const find = diagram.querySelector<HTMLInputElement>('[data-diagram-find]')
    find?.addEventListener('input', () => {
      diagramView(id).query = find.value
      applyDiagramFrame(scroll)
      syncDiagramWindow(scroll)
    })
  })
}

function headerSvg(scenario: Scenario, width: number, hiddenIds: ReadonlySet<string>, zoom: number): string {
  const boxes = visibleParticipants(scenario.participants, hiddenIds)
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
  const dispW = width * zoom
  const dispH = HEADER_BLOCK_H * zoom
  return `<svg class="seq-header-svg" viewBox="0 0 ${width} ${HEADER_BLOCK_H}" width="${dispW}" height="${dispH}" role="img" aria-label="Participants">${boxes}</svg>`
}

function windowSvg(diagram: MountedDiagram, slice: LayoutRow[], view: DiagramView, width: number): string {
  const { scenario, rows } = diagram
  const offset = slice[0].y
  const end = slice[slice.length - 1].y + slice[slice.length - 1].height
  const height = Math.max(end - offset, 1)
  const visible = visibleParticipants(scenario.participants, view.hidden)
  const index = new Map(visible.map((p, i) => [p.id, i]))
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

  const lifelines = visible
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
      const fallback = colourOf.get(span.participantId) ?? '#34d399'
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

  const paint: RowPaint = { query: view.query, hiddenIds: view.hidden }
  const body = slice.map((row) => renderRow(row, width, index, colourOf, ensureMarker, diagram.labelMaxWidth, paint)).join('')
  const dispW = width * view.zoom
  const dispH = height * view.zoom

  return `
  <svg class="seq-svg" viewBox="0 ${offset} ${width} ${height}" width="${dispW}" height="${dispH}" aria-hidden="true">
    <defs>
      ${ACTIVATION_HATCH}
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
  labelMaxWidth = DEFAULT_LABEL_MAX_WIDTH,
  paint: RowPaint = EMPTY_PAINT,
): string {
  const visible = visibleParticipants(participants, paint.hiddenIds)
  const index = new Map(visible.map((p, i) => [p.id, i]))
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
  const body = renderRow(row, width, index, colourOf, ensureMarker, labelMaxWidth, paint)
  return `<svg><defs>${markers.join('')}</defs>${body}</svg>`
}

function renderRow(
  row: LayoutRow,
  width: number,
  index: Map<string, number>,
  colourOf: Map<string, string>,
  ensureMarker: (colour: string, end: ArrowEnd) => string,
  labelMaxWidth: number,
  paint: RowPaint = EMPTY_PAINT,
): string {
  const event = row.event
  if (eventHiddenByColumns(event, paint.hiddenIds)) return ''
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
    const match = rowMatchesQuery(event, paint.query)
    const hit = match ? ' search-hit' : ''
    const hitAttr = match ? ' data-search-hit="match"' : ''
    const matchCue = match ? `<tspan class="note-match-cue"> [match]</tspan>` : ''
    return `
    <g class="note note-${place}${hit}" data-placement="${place}"${hitAttr} transform="translate(${layout.x}, ${row.y})">
      <rect class="note-card" x="-70" y="-14" width="140" height="28" rx="6"/>
      <text class="note-text" y="4" text-anchor="${layout.textAnchor}">${escapeXml(event.text)}${matchCue}</text>
      <text class="note-place-cue" x="0" y="18" text-anchor="middle">${place}</text>
    </g>`
  }

  return renderMessageRow(event as MessageEvent, row.y, width, index, colourOf, ensureMarker, labelMaxWidth, paint.query)
}

function messageLabel(msg: MessageEvent, labelMaxWidth: number): string {
  const full = escapeXml(msg.label)
  const shown = escapeXml(truncateLabel(msg.label, labelMaxWidth))
  return `<title>${full}</title>${shown}`
}

function renderMessageRow(
  msg: MessageEvent,
  y: number,
  width: number,
  index: Map<string, number>,
  colourOf: Map<string, string>,
  ensureMarker: (colour: string, end: ArrowEnd) => string,
  labelMaxWidth: number,
  query: string,
): string {
  const spec = messageArrowSpec(msg.type)
  const match = rowMatchesQuery(msg, query)
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
  const matchCue = match ? `<tspan class="msg-match-cue"> [match]</tspan>` : ''
  const hitClass = match ? ' search-hit' : ''
  const hitAttr = match ? ' data-search-hit="match"' : ''
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
    <g class="message message-short${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} ${clickable} transform="translate(0, ${y})">
      <line class="msg-path" x1="${x1}" y1="0" x2="${x2}" y2="0" stroke="${colour}" stroke-width="2" ${markerEnd} ${dashed}/>
      <text class="msg-label" x="${labelX}" y="-8" text-anchor="middle">${messageLabel(msg, labelMaxWidth)}${cue}${matchCue}${dur}</text>
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
    <g class="message${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} ${clickable} transform="translate(0, ${y})">
      <path class="msg-path" d="M${x1 + ACT_W} 0 C${x1 + 48} 0, ${x1 + 48} 22, ${x1 + ACT_W} 22" fill="none" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
      <text class="msg-label" x="${x1 + 56}" y="4">${messageLabel(msg, labelMaxWidth)}${cue}${matchCue}${dur}</text>
      ${hasData ? `<circle class="msg-hit" cx="${x1 + 40}" cy="11" r="14"/>` : ''}
    </g>`
  }

  const labelX = (x1 + x2) / 2
  const lineX1 = x1 + (x2 > x1 ? ACT_W / 2 : -ACT_W / 2)
  const lineX2 = x2 + (x2 > x1 ? -ACT_W / 2 : ACT_W / 2)
  return `
  <g class="message${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} ${clickable} transform="translate(0, ${y})">
    <line class="msg-path" x1="${lineX1}" y1="0" x2="${lineX2}" y2="0" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
    <text class="msg-label" x="${labelX}" y="-8" text-anchor="middle">${messageLabel(msg, labelMaxWidth)}${cue}${matchCue}${dur}</text>
    ${hasData ? `<circle class="msg-hit" cx="${labelX}" cy="0" r="16"/>` : ''}
  </g>`
}

/** Y of a message row in the mounted diagram, for insight "show" scrolling. */
export function messageOffsetY(scenarioId: string, messageId: string): number | null {
  const diagram = mounted.get(scenarioId)
  if (!diagram) return null
  const row = diagram.rows.find((r) => r.event.kind === 'message' && r.event.id === messageId)
  return row ? row.y : null
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
