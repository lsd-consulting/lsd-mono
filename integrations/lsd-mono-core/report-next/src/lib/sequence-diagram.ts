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
  MESSAGE_LABEL_RISE,
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
  fittedView,
  messageLabelRect,
  rowMatchesQuery,
  searchCountLabel,
  stepZoom,
  unscaledViewport,
  visibleParticipants,
  zoomFromWheel,
  zoomLabel,
  type Rect,
} from './diagram-view'
import {
  focusScrollTop,
  focusableNeighbors,
  focusablePlaces,
  messageHasPayload,
  messageHitBox,
  messagePlaces,
  replacementFocus,
  tabindexFor,
  zoomScrollBehavior,
  type MessagePlace,
} from './diagram-a11y'
import {
  densityBins,
  fractionFromPointer,
  minimapViewportRange,
  scrubScrollTop,
  scrollTopFromMinimapFraction,
} from './minimap'

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
  /** Roving tabindex target. Null means the first focusable message. */
  activeMessageId: string | null
}

export interface RowPaint {
  query: string
  hiddenIds: ReadonlySet<string>
  places?: MessagePlace[]
  activeMessageId?: string | null
  neighbors?: Map<string, { prevArrowY?: number; nextArrowY?: number }>
}

const views = new Map<string, DiagramView>()
const EMPTY_PAINT: RowPaint = { query: '', hiddenIds: new Set() }

export function diagramView(scenarioId: string): DiagramView {
  let view = views.get(scenarioId)
  if (!view) {
    view = { zoom: DEFAULT_ZOOM, hidden: new Set(), query: '', activeMessageId: null }
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
 * XML ids cannot contain parentheses or a hash. A theme colour such as
 * `var(--accent)` was producing `url(#mk_filled_var(--accent))`, which the
 * browser drops, so only hex tips (sync responses) painted.
 */
export function arrowMarkerId(end: ArrowEnd, colour: string): string {
  const safe = colour.replace(/[^A-Za-z0-9_-]/g, '')
  return `mk_${end}_${safe || 'colour'}`
}

function markerSet(): {
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
        <button type="button" data-zoom="fit" aria-label="Fit to screen">Fit</button>
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
  const places = messagePlaces(scenario.events, view.hidden)
  const diagramTab = focusablePlaces(places).length ? -1 : 0
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
      <div class="seq-stage">
        <div class="seq-scroll" data-scenario-id="${escapeXml(scenario.id)}" tabindex="${diagramTab}" role="group" aria-label="Sequence diagram for ${escapeXml(scenario.title)}">
          <div class="seq-sticky-header" style="width:${width * zoom}px">${headerSvg(scenario, width, view.hidden, zoom)}</div>
          <div class="seq-spacer" style="height:${diagram.height * zoom}px;width:${width * zoom}px">
            <div class="seq-window"></div>
          </div>
        </div>
        ${minimapMarkup()}
      </div>
    </div>`
}

/** One track, one canvas, one window marker. Never one node per event. */
export function minimapMarkup(): string {
  return `<div class="seq-minimap" role="slider" aria-orientation="vertical" aria-label="Diagram overview" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><canvas class="seq-minimap-canvas" aria-hidden="true"></canvas><div class="seq-minimap-window" aria-hidden="true"></div></div>`
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
  const viewTop = slice.length ? sliceViewTop(offset) : 0
  windowEl.style.transform = `translateY(${viewTop * zoom}px)`
  const width = logicalWidth(diagram.scenario, view.hidden)
  scrollport.style.setProperty('--seq-header-h', `${cssHeader}px`)
  const prior = document.activeElement
  const priorBtn = prior instanceof Element ? prior.closest('button.msg-open') : null
  const hadFocus = Boolean(priorBtn && scrollport.contains(priorBtn) && !movingFocus)
  const priorId = priorBtn?.getAttribute('data-message-id') ?? null
  const places = messagePlaces(diagram.scenario.events, view.hidden)
  const painted = paintedMessageIds(slice, view.hidden)
  if (hadFocus && priorId) {
    const current = view.activeMessageId ?? priorId
    if (!painted.has(current)) {
      const next = replacementFocus(current, places, painted)
      if (next && painted.has(next)) view.activeMessageId = next
    }
  }
  const stops = focusablePlaces(places)
  const tabTarget =
    view.activeMessageId && stops.some((place) => place.id === view.activeMessageId)
      ? view.activeMessageId
      : (stops[0]?.id ?? null)
  // One tab stop: the active arrow when it is painted, otherwise the scrollport.
  scrollport.tabIndex = tabTarget && painted.has(tabTarget) ? -1 : 0
  windowEl.innerHTML = slice.length ? windowSvg(diagram, slice, view, width, viewTop) : ''
  if (hadFocus) {
    const target = view.activeMessageId ?? priorId
    if (target) {
      const btn = windowEl.querySelector<HTMLButtonElement>(
        `button.msg-open[data-message-id="${cssEscape(target)}"]`,
      )
      btn?.focus({ preventScroll: true })
    }
  }
  syncMinimap(scrollport)
}

/** SVG viewBox top. Includes the label drawn above the first painted row. */
export function sliceViewTop(firstRowY: number): number {
  return Math.max(0, firstRowY - MESSAGE_LABEL_RISE)
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
  paintMinimapDensity(scrollport)
}

function commitZoom(
  scrollport: HTMLElement,
  next: number,
  pin?: { top: number; left: number },
  motion: ScrollBehavior = 'auto',
): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const view = diagramView(id)
  const prev = view.zoom || 1
  const ratio = next / prev
  view.zoom = next
  applyDiagramFrame(scrollport)
  const top = pin ? pin.top : scrollport.scrollTop * ratio
  const left = pin ? pin.left : scrollport.scrollLeft * ratio
  scrollport.scrollTo({ top, left, behavior: motion })
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
  else if (action === 'fit') {
    const fitted = fittedView({
      contentWidth: logicalWidth(diagram.scenario, view.hidden),
      viewportWidth: scrollport.clientWidth,
      viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
      mustInclude: topMessageLabelRect(diagram, view.hidden),
    })
    commitZoom(
      scrollport,
      fitted.scale,
      {
        top: Math.max(0, fitted.originY) * fitted.scale,
        left: Math.max(0, fitted.originX) * fitted.scale,
      },
      zoomScrollBehavior(prefersReducedMotion()),
    )
    return
  } else return
  commitZoom(scrollport, next, undefined, zoomScrollBehavior(prefersReducedMotion()))
}

/** Label box of the uppermost message still drawn. Fit scrolls this into view. */
function topMessageLabelRect(diagram: MountedDiagram, hiddenIds: ReadonlySet<string>): Rect {
  const width = logicalWidth(diagram.scenario, hiddenIds)
  const visible = visibleParticipants(diagram.scenario.participants, hiddenIds)
  const index = new Map(visible.map((p, i) => [p.id, i]))
  for (const row of diagram.rows) {
    const event = row.event
    if (event.kind !== 'message' || eventHiddenByColumns(event, hiddenIds)) continue
    const ends = messageEndpoints(event, index, width)
    return messageLabelRect({ arrowY: row.y, x1: ends.x1, x2: ends.x2 })
  }
  return { x: 0, y: 0, width: 1, height: 1 }
}

function messageEndpoints(
  msg: MessageEvent,
  index: Map<string, number>,
  width: number,
): { x1: number; x2: number } {
  if (msg.type === 'SHORT_INBOUND' || msg.type === 'SHORT_OUTBOUND') {
    const participantId = msg.type === 'SHORT_INBOUND' ? msg.to : msg.from
    const px = xFor(index.get(participantId) ?? 0)
    return shortMessageEndpoints(msg.type, px, width)
  }
  const fi = index.get(msg.from) ?? 0
  const ti = index.get(msg.to) ?? 0
  return { x1: xFor(fi), x2: xFor(ti) }
}

function onToggleParticipant(scrollport: HTMLElement, participantId: string): void {
  const id = scrollport.dataset.scenarioId
  if (!id || !participantId) return
  const view = diagramView(id)
  if (view.hidden.has(participantId)) view.hidden.delete(participantId)
  else view.hidden.add(participantId)
  const places = messagePlaces(mounted.get(id)?.scenario.events ?? [], view.hidden)
  if (view.activeMessageId && !focusablePlaces(places).some((place) => place.id === view.activeMessageId)) {
    view.activeMessageId = null
  }
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
    bindMinimap(diagram, scroll)
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

function windowSvg(
  diagram: MountedDiagram,
  slice: LayoutRow[],
  view: DiagramView,
  width: number,
  viewTop: number,
): string {
  const { scenario, rows } = diagram
  const offset = slice[0].y
  const end = slice[slice.length - 1].y + slice[slice.length - 1].height
  const height = Math.max(end - viewTop, 1)
  const visible = visibleParticipants(scenario.participants, view.hidden)
  const index = new Map(visible.map((p, i) => [p.id, i]))
  const colourOf = new Map(scenario.participants.map((p) => [p.id, p.colour ?? 'var(--accent)']))
  const spans = activationSpans(rows, Math.max(diagram.height - BOTTOM_PAD, 0))

  const markers = markerSet()
  const ensureMarker = markers.ensure

  const lifelines = visible
    .map((p, i) => {
      const x = xFor(i)
      return `<line class="lifeline-line" data-participant="${escapeXml(p.id)}" x1="${x}" y1="${viewTop}" x2="${x}" y2="${end}" />`
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

  const paint: RowPaint = {
    query: view.query,
    hiddenIds: view.hidden,
    places: messagePlaces(scenario.events, view.hidden),
    activeMessageId: view.activeMessageId,
    neighbors: focusableNeighbors(rows, view.hidden),
  }
  const buttons: string[] = []
  const body = slice
    .map((row) => renderRow(row, width, index, colourOf, ensureMarker, diagram.labelMaxWidth, paint, buttons, viewTop, view.zoom))
    .join('')
  const dispW = width * view.zoom
  const dispH = height * view.zoom

  return `
  <svg class="seq-svg" viewBox="0 ${viewTop} ${width} ${height}" width="${dispW}" height="${dispH}" aria-hidden="true">
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
  ${buttons.length ? `<div role="list" class="msg-places" aria-label="Sequence messages">${buttons.join('')}</div>` : ''}
`
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
  buttons: string[],
  viewTop: number,
  zoom: number,
  paint: RowPaint,
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
  const hasData = messageHasPayload(msg)
  const dur = msg.durationMs != null ? `<tspan class="msg-dur"> · ${msg.durationMs}ms</tspan>` : ''
  const cue = spec.typeCue
    ? `<tspan class="msg-type-cue"> [${escapeXml(spec.typeCue)}]</tspan>`
    : ''
  const matchCue = match ? `<tspan class="msg-match-cue"> [match]</tspan>` : ''
  const hitClass = match ? ' search-hit' : ''
  const hitAttr = match ? ' data-search-hit="match"' : ''
  const typeAttr = `data-msg-type="${escapeXml(msg.type)}"`
  if (hasData) buttons.push(messageOpenButton(msg, y, width, index, viewTop, zoom, paint))

  if (msg.type === 'SHORT_INBOUND' || msg.type === 'SHORT_OUTBOUND') {
    const participantId = msg.type === 'SHORT_INBOUND' ? msg.to : msg.from
    const pi = index.get(participantId) ?? 0
    const px = xFor(pi)
    const { x1, x2 } = shortMessageEndpoints(msg.type, px, width)
    const labelX = (x1 + x2) / 2
    return `
    <g class="message message-short${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} transform="translate(0, ${y})">
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
    <g class="message${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} transform="translate(0, ${y})">
      <path class="msg-path" d="M${x1 + ACT_W} 0 C${x1 + 48} 0, ${x1 + 48} 22, ${x1 + ACT_W} 22" fill="none" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
      <text class="msg-label" x="${x1 + 56}" y="4">${messageLabel(msg, labelMaxWidth)}${cue}${matchCue}${dur}</text>
      ${hasData ? `<circle class="msg-hit" cx="${x1 + 40}" cy="11" r="14"/>` : ''}
    </g>`
  }

  const labelX = (x1 + x2) / 2
  const lineX1 = x1 + (x2 > x1 ? ACT_W / 2 : -ACT_W / 2)
  const lineX2 = x2 + (x2 > x1 ? -ACT_W / 2 : ACT_W / 2)
  return `
  <g class="message${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} transform="translate(0, ${y})">
    <line class="msg-path" x1="${lineX1}" y1="0" x2="${lineX2}" y2="0" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
    <text class="msg-label" x="${labelX}" y="-8" text-anchor="middle">${messageLabel(msg, labelMaxWidth)}${cue}${matchCue}${dur}</text>
    ${hasData ? `<circle class="msg-hit" cx="${labelX}" cy="0" r="16"/>` : ''}
  </g>`
}

/**
 * Real button over the arrow and its label. The SVG itself is aria-hidden,
 * so a role on the line would be skipped by screen readers.
 */
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
  const label = messageLabelRect({ arrowY: y, x1: ends.x1, x2: ends.x2 })
  const neighbor = paint.neighbors?.get(msg.id)
  const box = messageHitBox({
    label,
    zoom,
    viewTop,
    prevArrowY: neighbor?.prevArrowY,
    nextArrowY: neighbor?.nextArrowY,
  })
  const places = paint.places ?? [{ id: msg.id, posinset: 1, setsize: 1, focusable: true }]
  const place = places.find((item) => item.id === msg.id) ?? places[0]
  const tab = tabindexFor(msg.id, paint.activeMessageId ?? null, places)
  // posinset/setsize are not valid on button. The listitem carries the real index.
  return `<div role="listitem" class="msg-place" aria-setsize="${place.setsize}" aria-posinset="${place.posinset}"><button type="button" class="msg-open" data-message-id="${escapeXml(msg.id)}" aria-label="Open ${escapeXml(msg.label)}" tabindex="${tab}" style="left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px"></button></div>`
}

let movingFocus = false

const MINIMAP_BINS = 48

/** Draw density ticks into the canvas. Bin count is fixed; event count is not. */
export function paintMinimapDensity(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = mounted.get(id)
  const root = scrollport.closest('.seq-diagram')
  const canvas = root?.querySelector<HTMLCanvasElement>('.seq-minimap-canvas')
  if (!diagram || !canvas) return
  const view = diagramView(id)
  const track = canvas.parentElement
  const cssW = Math.max(8, track?.clientWidth || 12)
  const cssH = Math.max(32, track?.clientHeight || scrollport.clientHeight || DEFAULT_VIEWPORT)
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const contentHeight = Math.max(1, diagram.height * view.zoom)
  const bins = densityBins(
    diagram.rows.map((row) => row.y * view.zoom),
    contentHeight,
    MINIMAP_BINS,
  )
  const max = Math.max(1, ...bins)
  const gap = 1
  const binH = cssH / bins.length
  ctx.fillStyle = 'rgba(148, 163, 184, 0.55)'
  bins.forEach((count, index) => {
    if (!count) return
    const w = Math.max(2, (count / max) * (cssW - 2))
    ctx.fillRect(cssW - w, index * binH + gap / 2, w, Math.max(1, binH - gap))
  })
  syncMinimap(scrollport)
}

/** Move the viewport marker to match the scrollport. */
export function syncMinimap(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = mounted.get(id)
  const root = scrollport.closest('.seq-diagram')
  const minimap = root?.querySelector<HTMLElement>('.seq-minimap')
  const marker = minimap?.querySelector<HTMLElement>('.seq-minimap-window')
  if (!diagram || !minimap || !marker) return
  const view = diagramView(id)
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
  const cssHeader = header?.offsetHeight || HEADER_BLOCK_H * view.zoom
  const contentHeight = diagram.height * view.zoom
  const range = minimapViewportRange({
    scrollTop: scrollport.scrollTop,
    viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
    headerHeight: cssHeader,
    contentHeight,
  })
  marker.style.top = `${range.top * 100}%`
  marker.style.height = `${Math.max(range.height * 100, 2)}%`
  const value = Math.round(range.top * 100)
  minimap.setAttribute('aria-valuenow', String(value))
  minimap.setAttribute('aria-valuetext', `${value}% through diagram`)
}

function bindMinimap(diagramRoot: HTMLElement, scrollport: HTMLElement): void {
  const minimap = diagramRoot.querySelector<HTMLElement>('.seq-minimap')
  if (!minimap) return
  paintMinimapDensity(scrollport)

  const readMetrics = () => {
    const id = scrollport.dataset.scenarioId
    const diagram = id ? mounted.get(id) : undefined
    const view = id ? diagramView(id) : undefined
    const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
    const zoom = view?.zoom ?? 1
    return {
      headerHeight: header?.offsetHeight || HEADER_BLOCK_H * zoom,
      contentHeight: (diagram?.height ?? 0) * zoom,
      viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
    }
  }

  const jumpTo = (clientY: number) => {
    const rect = minimap.getBoundingClientRect()
    const fraction = fractionFromPointer(clientY, rect.top, rect.height)
    const metrics = readMetrics()
    // Direct assignment: never an animated glide (honours reduced motion).
    scrollport.scrollTop = scrollTopFromMinimapFraction({ fractionY: fraction, ...metrics })
    syncDiagramWindow(scrollport)
  }

  let dragging = false
  minimap.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    dragging = true
    minimap.setPointerCapture(ev.pointerId)
    jumpTo(ev.clientY)
    ev.preventDefault()
  })
  minimap.addEventListener('pointermove', (ev) => {
    if (!dragging) return
    jumpTo(ev.clientY)
  })
  const endDrag = (ev: PointerEvent) => {
    if (!dragging) return
    dragging = false
    if (minimap.hasPointerCapture(ev.pointerId)) minimap.releasePointerCapture(ev.pointerId)
  }
  minimap.addEventListener('pointerup', endDrag)
  minimap.addEventListener('pointercancel', endDrag)

  minimap.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
    ev.preventDefault()
    ev.stopPropagation()
    const metrics = readMetrics()
    scrollport.scrollTop = scrubScrollTop({
      scrollTop: scrollport.scrollTop,
      direction: ev.key === 'ArrowDown' ? 1 : -1,
      ...metrics,
    })
    syncDiagramWindow(scrollport)
  })
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1')
}

function paintedMessageIds(slice: LayoutRow[], hiddenIds: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>()
  for (const row of slice) {
    const event = row.event
    if (event.kind === 'message' && messageHasPayload(event) && !eventHiddenByColumns(event, hiddenIds)) ids.add(event.id)
  }
  return ids
}

/** Scroll the arrow into view if needed, then focus its button. One tab stop. */
export function focusDiagramMessage(scrollport: HTMLElement, messageId: string): void {
  const scenarioId = scrollport.dataset.scenarioId
  if (!scenarioId) return
  const view = diagramView(scenarioId)
  view.activeMessageId = messageId
  const diagram = mounted.get(scenarioId)
  const row = diagram?.rows.find((item) => item.event.kind === 'message' && item.event.id === messageId)
  movingFocus = true
  try {
    if (row) {
      const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
      const cssHeader = header?.offsetHeight || HEADER_BLOCK_H * view.zoom
      const unscaled = unscaledViewport({
        scrollTop: scrollport.scrollTop,
        viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
        headerHeight: cssHeader,
        zoom: view.zoom,
      })
      const labelY = row.y - MESSAGE_LABEL_RISE
      const viewBottom = unscaled.scrollTop + Math.max(0, unscaled.viewportHeight - unscaled.headerHeight)
      if (labelY < unscaled.scrollTop || row.y > viewBottom) {
        scrollport.scrollTop = focusScrollTop(row.y, view.zoom)
      }
    }
    syncDiagramWindow(scrollport)
  } finally {
    movingFocus = false
  }
  const btn = scrollport.querySelector<HTMLButtonElement>(
    `button.msg-open[data-message-id="${cssEscape(messageId)}"]`,
  )
  btn?.focus({ preventScroll: true })
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
