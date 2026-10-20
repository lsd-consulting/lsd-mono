// The sequence diagram: mounting, frame and pads, the HTML shell and message focus. Shapes, rows,
// the viewport lives in ./diagram; their state is one controller, diagramState.
import type { DiagramEvent, MessageEvent, Participant, Scenario } from '../types'
import { DEFAULT_LABEL_MAX_WIDTH, truncateLabel } from '../ui/format'
import { hasComponentDiagram } from './component-graph'
import { focusScrollTop, focusablePlaces, messageHasPayload, messagePlaces } from './diagram-a11y'
import { eventHiddenByColumns, unscaledViewport, visibleParticipants } from './diagram-view'
import { headerHtml } from './diagram/rows'
import { textViewHtml } from './diagram/text-view'
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
import { scenarioSearchState, searchStateHtml } from './diagram/search-reveal'
import { revealMessageX, syncDiagramWindow } from './diagram/viewport'
import { zoomControlsHtml } from './diagram/zoom-controls'
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

// The diagram's API for the app and tests; the modules in ./diagram import each other directly.
export { renderRowSvg } from './diagram/rows'
export { participantHeadFor, participantLabelSvg } from './diagram/shapes'
export { diagramView, forgetDiagrams, setFindHooks } from './diagram/state'
export { bindDiagramScroll, sliceViewTop, stepFind, syncDiagramWindow } from './diagram/viewport'

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

function mountDiagram(scenario: Scenario, labelMaxWidth = DEFAULT_LABEL_MAX_WIDTH): MountedDiagram {
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

/** Bar chart, drawn in currentColor. Decorative: the button's text is its name. */
const METRICS_ICON_SVG =
  '<svg class="panel-btn-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5"/></svg>'

/** Three linked nodes, drawn in currentColor. Decorative: the button's text is its name. */
const COMPONENTS_ICON_SVG =
  '<svg class="panel-btn-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M5.6 5.2 7 9.6M10.4 5.2 9 9.6M6 3.5h4"/><circle cx="4" cy="3.5" r="2"/><circle cx="12" cy="3.5" r="2"/><circle cx="8" cy="12" r="2"/></svg>'

interface PanelButton {
  kind: 'metrics' | 'components'
  scenarioId: string
  iconSvg: string
  text: string
  /** Why the button is disabled, or null when it is enabled. */
  disabledReason: string | null
}

/**
 * A toolbar button that opens a view in the side panel. aria-expanded says whether that
 * view is open for this scenario; the app keeps it in step with the panel.
 */
function panelButtonHtml(button: PanelButton): string {
  const disabledHtml = button.disabledReason === null ? '' : ` disabled title="${escapeAttr(button.disabledReason)}"`
  return `<button type="button" class="panel-btn ${button.kind}-open" data-show-${button.kind}="${escapeAttr(button.scenarioId)}" aria-controls="inspector" aria-expanded="false"${disabledHtml}>${button.iconSvg}<span>${escapeHtml(button.text)}</span></button>`
}

/** Opens the component diagram for this scenario in the inspector. Disabled when no message links two components. */
function componentsControl(scenario: Scenario): string {
  return panelButtonHtml({
    kind: 'components',
    scenarioId: scenario.id,
    iconSvg: COMPONENTS_ICON_SVG,
    text: 'Component diagram',
    disabledReason: hasComponentDiagram(scenario) ? null : 'No messages between components',
  })
}

/** Opens this scenario's metrics in the inspector. Disabled when there are none (metrics off or nothing timed). */
function metricsControl(scenario: Scenario): string {
  return panelButtonHtml({
    kind: 'metrics',
    scenarioId: scenario.id,
    iconSvg: METRICS_ICON_SVG,
    text: 'Metrics',
    disabledReason: scenario.metrics.length > 0 ? null : 'No metrics for this scenario',
  })
}

/** Find's accessible name: payloads are named only while they are searched. The pressed {} shows it on screen. */
export function findFieldLabel(searchesPayloads: boolean): string {
  return searchesPayloads
    ? 'Find messages, notes and payloads in this diagram'
    : 'Find messages and notes in this diagram'
}

/** Turns payloads in or out of Find. Only on a diagram with a payload to search. */
function payloadToggleHtml(scenario: Scenario, view: DiagramView): string {
  if (!scenarioHasPayloads(scenario)) return ''
  // Inside the field's right end, the braces of the arrows' payload marker, so the toolbar keeps its
  // width; its name stays "Payloads". Inside the label, but a button there does not focus the field.
  return `<button type="button" class="find-payloads" data-find-payloads aria-pressed="${view.includePayloads}" title="Find in message payloads too"><span aria-hidden="true">{}</span><span class="visually-hidden">Payloads</span></button>`
}

function scenarioHasPayloads(scenario: Scenario): boolean {
  return scenario.events.some((e) => e.kind === 'message' && messageHasPayload(e))
}

function toolbarHtml(scenario: Scenario, view: DiagramView): string {
  const find = scenarioSearchState(scenario.id)
  const steppable = find.hits.length > 0 ? '' : ' disabled'
  const label = findFieldLabel(view.includePayloads && scenarioHasPayloads(scenario))
  // The hidden-participants chip is drawn by bindParticipantFilter, and only while
  // something is hidden. The status line announces each hide and show.
  return `
    <div class="seq-toolbar" role="toolbar" aria-label="Diagram view">
      ${zoomControlsHtml(view)}
      <div class="participant-filter" data-participant-filter></div>
      <span class="participant-filter-status visually-hidden" role="status"></span>
      <label class="diagram-find">
        <span class="diagram-find-label">Find</span>
        <span class="find-field"><input type="search" data-diagram-find value="${escapeAttr(view.query)}" placeholder="Messages and notes" aria-label="${escapeAttr(label)}" autocomplete="off"/>${payloadToggleHtml(scenario, view)}</span>
        <span class="diagram-find-count" aria-live="polite">${searchStateHtml(find, view.query)}</span>
      </label>
      <div class="find-steps" role="group" aria-label="Step through matches">
        <button type="button" data-find-step="prev" aria-label="Previous match" title="Previous match (Shift+Enter)"${steppable}>↑</button>
        <button type="button" data-find-step="next" aria-label="Next match" title="Next match (Enter)"${steppable}>↓</button>
      </div>
      <div class="panel-controls" role="group" aria-label="Open in the side panel">
        ${metricsControl(scenario)}
        ${componentsControl(scenario)}
      </div>
    </div>`
}

/**
 * One line under the toolbar explaining the `{}` marker, only when an arrow has a payload.
 * The verb follows the pointer (CSS swaps click for tap on touch). Screen only.
 */
function payloadLegendHtml(scenario: Scenario): string {
  if (!scenarioHasPayloads(scenario)) return ''
  return `<p class="payload-legend"><span class="payload-legend-key" aria-hidden="true">{}</span><span class="visually-hidden">An arrow marked with braces</span> has a payload: <span class="legend-click">click</span><span class="legend-tap">tap</span> the arrow to open it</p>`
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
      ${payloadLegendHtml(scenario)}
      ${textViewHtml(
        scenario,
        diagram.rows.map((row) => row.event),
        view.hidden,
      )}
      <div class="seq-stage">
        <div class="seq-scroll" data-scenario-id="${escapeAttr(scenario.id)}" tabindex="${diagramTab}" role="group" aria-label="Sequence diagram for ${escapeAttr(scenario.title)}">
          <div class="seq-sticky-header" style="width:${width * zoom}px">${headerHtml(scenario, frame, view.hidden, zoom, null)}</div>
          <div class="seq-more"><button type="button" class="seq-more-btn" data-more-lanes tabindex="-1" aria-label="More lanes to the right: scroll right"><span>More lanes →</span></button></div>
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
function printWidthStyle(width: number): string {
  return `--seq-print-max:${Math.round(width * PRINT_MAX_UPSCALE)}px`
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
    revealMessageX(scrollport, messageId)
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
