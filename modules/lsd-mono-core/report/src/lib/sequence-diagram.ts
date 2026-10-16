// The sequence diagram: mounting, frame and pads, the HTML shell and message focus. Shapes, rows,
// the viewport lives in ./diagram; their state is one controller, diagramState.
import type { ActivateEvent, DiagramEvent, MessageEvent, NoteEvent, Participant, Scenario } from '../types'
import { DEFAULT_LABEL_MAX_WIDTH, truncateLabel } from '../ui/format'
import { hasComponentDiagram } from './component-graph'
import { focusScrollTop, focusablePlaces, messageHasPayload, messagePlaces } from './diagram-a11y'
import {
  classifySearchHits,
  eventHiddenByColumns,
  searchCountLabel,
  unscaledViewport,
  visibleParticipants,
  zoomLabel,
} from './diagram-view'
import { headerHtml } from './diagram/rows'
import {
  laneIndex,
  laneWidth,
  messageArrowSpec,
  noteLayout,
  participantHeadFor,
  shortLabelAnchor,
  shortMessageEndpoints,
  xFor,
} from './diagram/shapes'
import { type DiagramFrame, type DiagramView, type MountedDiagram, diagramState, diagramView } from './diagram/state'
import { syncDiagramWindow } from './diagram/viewport'
import { cssEscape, escapeAttr, escapeHtml } from './escape'
import {
  ACT_NEST_DX,
  ACT_W,
  DEFAULT_VIEWPORT,
  EDGE_MARGIN,
  HEADER_BLOCK_H,
  MESSAGE_LABEL_RISE,
  MSG_CHAR_W,
  NOTE_CARD_W,
  bodyHeight,
  diagramWidth,
  layoutRows,
} from './layout'
import type { LayoutRow } from './layout'

export { ACTIVATION_HATCH, headerHtml, renderRowSvg } from './diagram/rows'
export {
  type ArrowEnd,
  LANE_GAP,
  type MessageArrowSpec,
  type NoteLayout,
  type ParticipantHead,
  type ParticipantTypeLabel,
  activationBarSvg,
  arrowMarker,
  arrowMarkerId,
  laneCentres,
  laneIndex,
  messageArrowSpec,
  noteLayout,
  participantHead,
  participantHeadFor,
  participantLabelSvg,
  shortLabelAnchor,
  shortMessageEndpoints,
} from './diagram/shapes'
export {
  type DiagramFrame,
  type DiagramView,
  type MountedDiagram,
  type RowPaint,
  diagramView,
  forgetDiagrams,
} from './diagram/state'
export {
  applyDiagramFrame,
  bindDiagramScroll,
  setHiddenParticipants,
  sliceViewTop,
  syncDiagramWindow,
} from './diagram/viewport'

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
  if (msg.order === 'CLOCK') text += '  clock'
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
    if (event.type === 'SHORT_INBOUND' || event.type === 'SHORT_OUTBOUND') {
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

export function mountDiagram(scenario: Scenario, labelMaxWidth = DEFAULT_LABEL_MAX_WIDTH): MountedDiagram {
  const rows = layoutRows(scenario.events)
  const diagram: MountedDiagram = {
    scenario,
    rows,
    width: diagramWidth(scenario.participants.length),
    height: bodyHeight(rows),
    labelMaxWidth,
  }
  diagramState.mounted.set(scenario.id, diagram)
  return diagram
}

/** Opens the component diagram for this scenario in the inspector. Disabled when no message links two components. */
function componentsControl(scenario: Scenario): string {
  const drawable = hasComponentDiagram(scenario)
  const off = drawable ? '' : ' disabled title="No messages between components"'
  return `<button type="button" class="components-open" data-show-components="${escapeAttr(scenario.id)}"${off}>Component diagram</button>`
}

/** Opens this scenario's metrics in the inspector. Disabled when there are none (metrics off or nothing timed). */
function metricsControl(scenario: Scenario): string {
  const off = scenario.metrics.length > 0 ? '' : ' disabled title="No metrics for this scenario"'
  return `<button type="button" class="metrics-open" data-show-metrics="${escapeAttr(scenario.id)}"${off}>Metrics</button>`
}

function toolbarHtml(scenario: Scenario, view: DiagramView): string {
  const hits = classifySearchHits(scenario.events, view.query, view.hidden)
  // The hidden-participants chip is drawn by bindParticipantFilter, and only while
  // something is hidden. The status line announces each hide and show.
  return `
    <div class="seq-toolbar" role="toolbar" aria-label="Diagram view">
      <div class="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" data-zoom="out" aria-label="Zoom out">Out</button>
        <button type="button" data-zoom="fit" aria-label="Fit to screen">Fit</button>
        <span class="zoom-readout" aria-live="polite">${escapeHtml(zoomLabel(view.zoom))}</span>
        <button type="button" data-zoom="in" aria-label="Zoom in">In</button>
      </div>
      <div class="participant-filter" data-participant-filter></div>
      <span class="participant-filter-status visually-hidden" role="status"></span>
      <label class="diagram-find">
        <span class="diagram-find-label">Find</span>
        <input type="search" data-diagram-find value="${escapeAttr(view.query)}" placeholder="Messages and notes" aria-label="Find messages and notes in this diagram" autocomplete="off"/>
        <span class="diagram-find-count" aria-live="polite">${escapeHtml(searchCountLabel(hits.total, hits.hidden, view.query))}</span>
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
          return `<button type="button" data-jump-y="${row.y}">${escapeHtml(title)}</button>`
        })
        .join('')}</nav>`
    : ''
  return `
    <div class="seq-diagram" style="${printWidthStyle(width)}">
      ${jump}
      ${toolbarHtml(scenario, view)}
      <div class="seq-stage">
        <div class="seq-scroll" data-scenario-id="${escapeAttr(scenario.id)}" tabindex="${diagramTab}" role="group" aria-label="Sequence diagram for ${escapeAttr(scenario.title)}">
          <div class="seq-sticky-header" style="width:${width * zoom}px">${headerHtml(scenario, frame, view.hidden, zoom, null)}</div>
          <div class="seq-spacer" style="height:${diagram.height * zoom}px;width:${width * zoom}px">
            <div class="seq-window"></div>
          </div>
        </div>
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

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function paintedMessageIds(slice: LayoutRow[], hiddenIds: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>()
  for (const row of slice) {
    const event = row.event
    if (event.kind === 'message' && messageHasPayload(event) && !eventHiddenByColumns(event, hiddenIds))
      ids.add(event.id)
  }
  return ids
}

/** Scroll the arrow into view if needed, then focus its button. One tab stop. */
export function focusDiagramMessage(scrollport: HTMLElement, messageId: string): void {
  const scenarioId = scrollport.dataset.scenarioId
  if (!scenarioId) return
  const view = diagramView(scenarioId)
  view.activeMessageId = messageId
  const diagram = diagramState.mounted.get(scenarioId)
  const row = diagram?.rows.find((item) => item.event.kind === 'message' && item.event.id === messageId)
  diagramState.movingFocus = true
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
    diagramState.movingFocus = false
  }
  const btn = scrollport.querySelector<HTMLButtonElement>(`button.msg-open[data-message-id="${cssEscape(messageId)}"]`)
  btn?.focus({ preventScroll: true })
}

/** Y of a message row in the mounted diagram, for the Timing view's rows. */
export function messageOffsetY(scenarioId: string, messageId: string): number | null {
  const diagram = diagramState.mounted.get(scenarioId)
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
