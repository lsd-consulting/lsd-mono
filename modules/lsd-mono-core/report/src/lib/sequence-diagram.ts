import type {
  ActivateEvent,
  DiagramEvent,
  MessageEvent,
  MessageType,
  NoteEvent,
  NotePlacement,
  Participant,
  ParticipantType,
  Scenario,
} from '../types'
import {
  ACT_NEST_DX,
  ACT_W,
  BOTTOM_PAD,
  COL_GAP,
  DEFAULT_OVERSCAN,
  DEFAULT_VIEWPORT,
  EDGE_INSET,
  EDGE_MARGIN,
  HEADER_BLOCK_H,
  LEFT_PAD,
  MESSAGE_LABEL_RISE,
  MSG_CHAR_W,
  NOTE_CARD_W,
  NOTE_LINE_H,
  SECTION_BAND_H,
  SECTION_BAND_Y,
  SELF_RETURN_DY,
  SHORT_STUB,
  activationDepthAt,
  activationSpans,
  bodyHeight,
  diagramWidth,
  layoutRows,
  noteCardMetrics,
  virtualRowRange,
  type ActivationSpan,
  type LayoutRow,
} from './layout'
import { DEFAULT_LABEL_MAX_WIDTH, truncateLabel } from '../ui/format'
import {
  DEFAULT_ZOOM,
  classifySearchHits,
  eventHiddenByColumns,
  fittedView,
  settleFitWidth,
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
import { hasComponentDiagram } from './component-graph'
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
  /** Bars for the whole scenario. Arrows attach to the innermost bar at their row. */
  activations?: ActivationSpan[]
  /** Padding around the lifeline area. HTML overlays and full-width bands use it. */
  frame?: DiagramFrame
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

/**
 * Horizontal frame of a diagram. Lifelines are laid out across [base], from
 * x = 0. Notes, self-call labels and short-arrow labels on the outer lifelines
 * can reach past that, so the drawing adds [left] and [right] and the SVG
 * viewBox starts at -left.
 */
export interface DiagramFrame {
  base: number
  left: number
  right: number
  total: number
}

function frameOf(diagram: MountedDiagram, hiddenIds: ReadonlySet<string>): DiagramFrame {
  const visible = visibleParticipants(diagram.scenario.participants, hiddenIds)
  const base = diagramWidth(visible.length)
  const pads = diagramPads(diagram.scenario.events, visible, diagram.labelMaxWidth)
  return { base, ...pads, total: base + pads.left + pads.right }
}

/** Approximate drawn width of a message label with its type cue and duration. */
function messageLabelWidth(msg: MessageEvent, labelMaxWidth: number): number {
  const cue = messageArrowSpec(msg.type).typeCue
  let text = truncateLabel(msg.label, labelMaxWidth)
  if (cue) text += ` [${cue}]`
  if (msg.durationMs != null) text += ` · ${msg.durationMs}ms`
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
  const index = new Map(visible.map((p, i) => [p.id, i]))
  const width = diagramWidth(visible.length)
  let minX = EDGE_MARGIN
  let maxX = width - EDGE_MARGIN
  const reach = (from: number, to: number) => {
    minX = Math.min(minX, from)
    maxX = Math.max(maxX, to)
  }
  for (const event of events) {
    if (event.kind === 'note') {
      if (event.over && !index.has(event.over)) continue
      const { x } = noteLayout(event.placement, event.over, index, width)
      reach(x - NOTE_CARD_W / 2, x + NOTE_CARD_W / 2)
      continue
    }
    if (event.kind !== 'message') continue
    const w = messageLabelWidth(event, labelMaxWidth)
    if (event.type === 'SHORT_INBOUND' || event.type === 'SHORT_OUTBOUND') {
      const id = event.type === 'SHORT_INBOUND' ? event.to : event.from
      const i = index.get(id)
      if (i === undefined) continue
      // Nested bars can push the stub right by a few px; allow two levels.
      const { x1, x2 } = shortMessageEndpoints(event.type, xFor(i), width)
      const label = shortLabelAnchor(event.type, x1, x2)
      if (label.anchor === 'start') reach(x1, label.x + w + 2 * ACT_NEST_DX)
      else reach(label.x - w, x2 + 2 * ACT_NEST_DX)
      continue
    }
    const fi = index.get(event.from)
    const ti = index.get(event.to)
    if (fi === undefined || ti === undefined) continue
    if (event.from === event.to) {
      const x = xFor(fi)
      reach(x, x + SELF_LABEL_DX + 2 * ACT_NEST_DX + w)
      continue
    }
    const mid = (xFor(fi) + xFor(ti)) / 2
    reach(mid - w / 2, mid + w / 2)
  }
  return {
    left: Math.ceil(Math.max(0, EDGE_MARGIN - minX)),
    right: Math.ceil(Math.max(0, maxX - (width - EDGE_MARGIN))),
  }
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

/**
 * Header geometry for one captured participant type.
 * Unknown values (including legacy CONTROL / COLLECTIONS, which this model does not capture)
 * stay on the component box. The shape differs; [typeLabel] is the text cue.
 */
export interface ParticipantHead {
  type: ParticipantType
  typeLabel: string
  /** SVG for the shape only. The name is a separate text node. */
  shape: string
  /** Baseline for the participant name, in header units. */
  labelY: number
}

export function participantHead(type: string | undefined): ParticipantHead {
  switch (type) {
    case 'ACTOR':
      return {
        type: 'ACTOR',
        typeLabel: 'actor',
        labelY: 50,
        shape: `<g class="participant-actor">
          <circle cx="0" cy="11" r="5.5"/>
          <path d="M0 16.5 V28 M-11 22 H11 M0 28 L-8 38 M0 28 L8 38"/>
        </g>`,
      }
    case 'DATABASE':
      return {
        type: 'DATABASE',
        typeLabel: 'database',
        labelY: 30,
        shape: `<g class="participant-database">
          <path class="participant-shape" d="M-46 16 v16 a46 6 0 0 0 92 0 v-16"/>
          <ellipse class="participant-shape" cx="0" cy="16" rx="46" ry="6"/>
        </g>`,
      }
    case 'QUEUE':
      return {
        type: 'QUEUE',
        typeLabel: 'queue',
        labelY: 34,
        shape: `<g class="participant-queue">
          <polygon class="participant-shape participant-queue-back" points="-44,6 34,6 46,16 -32,16"/>
          <polygon class="participant-shape" points="-48,18 36,18 50,44 -34,44"/>
        </g>`,
      }
    case 'ENTITY':
      return {
        type: 'ENTITY',
        typeLabel: 'entity',
        labelY: 50,
        shape: `<circle class="participant-shape" cx="0" cy="22" r="14"/>`,
      }
    case 'BOUNDARY':
      return {
        type: 'BOUNDARY',
        typeLabel: 'boundary',
        labelY: 50,
        shape: `<g class="participant-boundary">
          <line class="participant-mark" x1="-16" y1="6" x2="-16" y2="38"/>
          <circle class="participant-shape" cx="0" cy="22" r="14"/>
        </g>`,
      }
    default:
      return {
        type: 'PARTICIPANT',
        typeLabel: 'component',
        labelY: 32,
        shape: `<rect class="participant-shape" x="-48" y="14" width="96" height="28" rx="4"/>`,
      }
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

/** Gap between a short arrow's bar end and its label. */
const SHORT_LABEL_GAP = 4

/**
 * Short-arrow label position. Outbound labels start just past the bar edge and
 * run toward the diagram edge; inbound labels end just before it.
 */
export function shortLabelAnchor(
  type: 'SHORT_INBOUND' | 'SHORT_OUTBOUND',
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

/** Opens the component diagram for this scenario in the inspector. Disabled when no message links two components. */
function componentsControl(scenario: Scenario): string {
  const drawable = hasComponentDiagram(scenario)
  const off = drawable ? '' : ' disabled title="No messages between components"'
  return `<button type="button" class="components-open" data-show-components="${escapeXml(scenario.id)}"${off}>Component diagram</button>`
}

/** Opens this scenario's metrics in the inspector. Disabled when there are none (metrics off or nothing timed). */
function metricsControl(scenario: Scenario): string {
  const any = scenario.metrics.length > 0 || (scenario.insights?.length ?? 0) > 0
  const off = any ? '' : ' disabled title="No metrics for this scenario"'
  return `<button type="button" class="metrics-open" data-show-metrics="${escapeXml(scenario.id)}"${off}>Metrics</button>`
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
      <div class="panel-controls" role="group" aria-label="Open in the side panel">
        ${metricsControl(scenario)}
        ${componentsControl(scenario)}
      </div>
    </div>`
}

/** Continuous diagram: sticky participant header, section jump list, virtualised rows. */
export function renderDiagramHtml(scenario: Scenario, labelMaxWidth = DEFAULT_LABEL_MAX_WIDTH): string {
  const diagram = mountDiagram(scenario, labelMaxWidth)
  const view = diagramView(scenario.id)
  const frame = frameOf(diagram, view.hidden)
  const width = frame.total
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
    <div class="seq-diagram" style="${printWidthStyle(width)}">
      ${jump}
      ${toolbarHtml(scenario, view)}
      <div class="seq-stage">
        <div class="seq-scroll" data-scenario-id="${escapeXml(scenario.id)}" tabindex="${diagramTab}" role="group" aria-label="Sequence diagram for ${escapeXml(scenario.title)}">
          <div class="seq-sticky-header" style="width:${width * zoom}px">${headerSvg(scenario, frame, view.hidden, zoom)}</div>
          <div class="seq-spacer" style="height:${diagram.height * zoom}px;width:${width * zoom}px">
            <div class="seq-window"></div>
          </div>
        </div>
        ${minimapMarkup()}
      </div>
    </div>`
}

/**
 * Print draws the diagram across the page width. A small diagram grows at most
 * this much, so a two-lifeline sequence does not print with huge labels.
 */
export const PRINT_MAX_UPSCALE = 1.5

/** Upper bound for the printed width, from the unzoomed drawing width. */
export function printWidthStyle(width: number): string {
  return `--seq-print-max:${Math.round(width * PRINT_MAX_UPSCALE)}px`
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
  // Print paints every row in one drawing from the top, so it can scale to the page width.
  const viewTop = slice.length && !printAllRows ? sliceViewTop(offset) : 0
  windowEl.style.transform = `translateY(${viewTop * zoom}px)`
  const frame = frameOf(diagram, view.hidden)
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
  windowEl.innerHTML = slice.length ? windowSvg(diagram, slice, view, frame, viewTop) : ''
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
  const frame = frameOf(diagram, view.hidden)
  const width = frame.total
  const zoom = view.zoom
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
  if (header) {
    header.style.width = `${width * zoom}px`
    header.innerHTML = headerSvg(diagram.scenario, frame, view.hidden, zoom)
  }
  const spacer = scrollport.querySelector<HTMLElement>('.seq-spacer')
  if (spacer) {
    spacer.style.height = `${diagram.height * zoom}px`
    spacer.style.width = `${width * zoom}px`
  }
  const root = scrollport.closest<HTMLElement>('.seq-diagram')
  if (!root) return
  root.style.setProperty('--seq-print-max', `${Math.round(width * PRINT_MAX_UPSCALE)}px`)
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
    const contentWidth = frameOf(diagram, view.hidden).total
    const mustInclude = topMessageLabelRect(diagram, view.hidden)
    const fitAt = (viewportWidth: number) =>
      fittedView({
        contentWidth,
        viewportWidth,
        viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
        mustInclude,
      })
    // Zooming can add or drop the vertical scrollbar, which changes the width
    // there is to fit; settle on a width that still fits once zoomed.
    const width = settleFitWidth(scrollport.clientWidth, (w) => {
      view.zoom = fitAt(w).scale
      applyDiagramFrame(scrollport)
      return scrollport.clientWidth
    })
    const fitted = fitAt(width)
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
  const frame = frameOf(diagram, hiddenIds)
  const width = frame.base
  const visible = visibleParticipants(diagram.scenario.participants, hiddenIds)
  const index = new Map(visible.map((p, i) => [p.id, i]))
  for (const row of diagram.rows) {
    const event = row.event
    if (event.kind !== 'message' || eventHiddenByColumns(event, hiddenIds)) continue
    const ends = messageEndpoints(event, index, width)
    const rect = messageLabelRect({ arrowY: row.y, x1: ends.x1, x2: ends.x2 })
    // Fit works in drawn coordinates, which start frame.left left of x = 0.
    return { ...rect, x: rect.x + frame.left }
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

function headerSvg(scenario: Scenario, frame: DiagramFrame, hiddenIds: ReadonlySet<string>, zoom: number): string {
  const width = frame.total
  const visible = visibleParticipants(scenario.participants, hiddenIds)
  const boxes = visible
    .map((p, i) => {
      const x = xFor(i)
      const name = p.alias ?? p.name
      const head = participantHead(p.type)
      const colour = escapeXml(p.colour ?? '#94a3b8')
      return `
      <g class="participant-box" data-participant="${escapeXml(p.id)}" data-participant-type="${head.type}" transform="translate(${x}, 0)" style="--pc:${colour}">
        <title>${escapeXml(name)}, ${head.typeLabel}</title>
        ${head.shape}
        <text class="participant-label" y="${head.labelY}" text-anchor="middle">${escapeXml(name)}</text>
      </g>`
    })
    .join('')
  const summary = visible
    .map((p) => `${p.alias ?? p.name} ${participantHead(p.type).typeLabel}`)
    .join(', ')
  const dispW = width * zoom
  const dispH = HEADER_BLOCK_H * zoom
  return `<svg class="seq-header-svg" viewBox="${-frame.left} 0 ${width} ${HEADER_BLOCK_H}" width="${dispW}" height="${dispH}" role="img" aria-label="Participants: ${escapeXml(summary)}">${boxes}</svg>`
}

function windowSvg(
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
      const x = xFor(i) - ACT_W / 2 + span.depth * ACT_NEST_DX
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
    activations: spans,
    frame,
  }
  const buttons: string[] = []
  const body = slice
    .map((row) => renderRow(row, width, index, colourOf, ensureMarker, diagram.labelMaxWidth, paint, buttons, viewTop, view.zoom))
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
      <rect class="section-band" x="${12 - (paint.frame?.left ?? 0)}" y="${SECTION_BAND_Y}" width="${Math.max(width + (paint.frame?.left ?? 0) + (paint.frame?.right ?? 0) - 24, 24)}" height="${SECTION_BAND_H}" rx="8"/>
      <text class="section-title" x="${24 - (paint.frame?.left ?? 0)}" y="28">${escapeXml(event.title)}</text>
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
    const card = noteCardMetrics(event.text)
    const halfW = card.width / 2
    const halfH = card.height / 2
    // Centre the wrapped lines in the card. Placement is layout only, so the card
    // holds nothing but the note text.
    const firstY = -(card.lines.length * NOTE_LINE_H) / 2 + NOTE_LINE_H * 0.8
    const tspans = card.lines
      .map((line, i) =>
        i === 0
          ? `<tspan x="0" y="${firstY}">${escapeXml(line)}</tspan>`
          : `<tspan x="0" dy="${NOTE_LINE_H}">${escapeXml(line)}</tspan>`,
      )
      .join('')
    // Search cue sits just above the card's top-right corner, so it never crowds the note copy.
    const matchCue = match
      ? `<text class="note-match-cue" x="${halfW}" y="${-halfH - 3}" text-anchor="end">[match]</text>`
      : ''
    return `
    <g class="note note-${place}${hit}" data-placement="${place}"${hitAttr} transform="translate(${layout.x}, ${row.y})">
      <rect class="note-card" x="${-halfW}" y="${-halfH}" width="${card.width}" height="${card.height}" rx="6"/>
      <text class="note-text" text-anchor="${layout.textAnchor}">${tspans}</text>
      ${matchCue}
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

  // Nested bars sit ACT_NEST_DX right of their parent, so arrows shift with them.
  const nest = (participantId: string, at: number) =>
    Math.max(activationDepthAt(paint.activations ?? [], participantId, at), 0) * ACT_NEST_DX

  if (msg.type === 'SHORT_INBOUND' || msg.type === 'SHORT_OUTBOUND') {
    const participantId = msg.type === 'SHORT_INBOUND' ? msg.to : msg.from
    const pi = index.get(participantId) ?? 0
    const px = xFor(pi) + nest(participantId, y)
    const { x1, x2 } = shortMessageEndpoints(msg.type, px, width)
    // The label runs away from the lifeline, so it never sits on the bar.
    const label = shortLabelAnchor(msg.type, x1, x2)
    const hitX = (x1 + x2) / 2
    return `
    <g class="message message-short${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} transform="translate(0, ${y})">
      <line class="msg-path" x1="${x1}" y1="0" x2="${x2}" y2="0" stroke="${colour}" stroke-width="2" ${markerEnd} ${dashed}/>
      <text class="msg-label" x="${label.x}" y="-8" text-anchor="${label.anchor}">${messageLabel(msg, labelMaxWidth)}${cue}${matchCue}${dur}</text>
      ${hasData ? `<circle class="msg-hit" cx="${hitX}" cy="0" r="16"/>` : ''}
    </g>`
  }

  const fi = index.get(msg.from) ?? 0
  const ti = index.get(msg.to) ?? 0
  const x1 = xFor(fi)
  const x2 = xFor(ti)
  const self = fi === ti && msg.from === msg.to

  if (self) {
    // Leaves the bar in use at the row and comes back to the innermost bar at the return.
    // A bar opened by this call starts at the return, one level deeper, so the
    // arrowhead lands on its edge.
    const out = x1 + ACT_W + nest(msg.from, y)
    const back = x1 + ACT_W + Math.max(activationDepthAt(paint.activations ?? [], msg.from, y + SELF_RETURN_DY) - 1, activationDepthAt(paint.activations ?? [], msg.from, y), 0) * ACT_NEST_DX
    const bend = Math.max(out, back) + 48 - ACT_W
    return `
    <g class="message${hasData ? ' has-data' : ''}${hitClass}" ${typeAttr}${hitAttr} transform="translate(0, ${y})">
      <path class="msg-path" d="M${out} 0 C${bend} 0, ${bend} ${SELF_RETURN_DY}, ${back} ${SELF_RETURN_DY}" fill="none" stroke="${colour}" stroke-width="2" ${markerEnd} ${markerStart} ${dashed}/>
      <text class="msg-label" x="${bend + 8}" y="4">${messageLabel(msg, labelMaxWidth)}${cue}${matchCue}${dur}</text>
      ${hasData ? `<circle class="msg-hit" cx="${bend - 8}" cy="11" r="14"/>` : ''}
    </g>`
  }

  const labelX = (x1 + x2) / 2
  const lineX1 = x1 + (x2 > x1 ? ACT_W / 2 : -ACT_W / 2) + nest(msg.from, y)
  const lineX2 = x2 + (x2 > x1 ? -ACT_W / 2 : ACT_W / 2) + nest(msg.to, y)
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
