// The sequence diagram: mounting, frame and pads, the HTML shell and message focus. Shapes, rows,
// the viewport lives in ./diagram; their state is one controller, diagramState.
import type { MessageEvent, Scenario } from '../types'
import { drawnFocusTarget, focusScrollTop, focusablePlaces, messageHasPayload, messagePlaces } from './diagram-a11y'
import { unscaledViewport } from './diagram-view'
import { headerHtml } from './diagram/rows'
import { messageArrowSpec } from './diagram/shapes'
import { textViewHtml } from './diagram/text-view'
import { type DiagramView, type MountedDiagram, diagramState, diagramView } from './diagram/state'
import { findFieldLabel, scenarioSearchState, searchStateHtml } from './diagram/search-reveal'
import { PRINT_MAX_UPSCALE, frameOf } from './diagram/geometry'
import { revealMessageX, syncDiagramWindow } from './diagram/window'
import { keepOnPage, scrollDiagramToOffset, shownHeight } from './diagram/page-scroll'
import { sequenceZoomShown, zoomControlsHtml } from './diagram/zoom-readout'
import { cssEscape, escapeAttr, escapeHtml } from './escape'
import { DEFAULT_VIEWPORT, HEADER_BLOCK_H, MESSAGE_LABEL_RISE, bodyHeight, diagramWidth, layoutRows } from './layout'

// The diagram's API for the app and tests; the modules in ./diagram import each other directly.
export { renderRowSvg } from './diagram/rows'
export { participantHeadFor, participantLabelSvg } from './diagram/shapes'
export { diagramView, forgetDiagrams, setFindHooks } from './diagram/state'
export { bindDiagramScroll } from './diagram/viewport'
export { stepFind } from './diagram/find-binding'
export { syncDiagramWindow } from './diagram/window'
export { PRINT_MAX_UPSCALE, diagramPads, frameOf, paintedMessageIds, sliceViewTop } from './diagram/geometry'
export { findFieldLabel } from './diagram/search-reveal'

function mountDiagram(scenario: Scenario, labelMaxWidth: number): MountedDiagram {
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

interface PanelButton {
  kind: 'metrics'
  scenarioId: string
  iconSvg: string
  text: string
}

/**
 * A toolbar button that opens a view in the side panel. aria-expanded says whether that
 * view is open for this scenario; the app keeps it in step with the panel.
 */
function panelButtonHtml(button: PanelButton): string {
  return `<button type="button" class="panel-btn ${button.kind}-open" data-show-${button.kind}="${escapeAttr(button.scenarioId)}" aria-controls="inspector" aria-expanded="false">${button.iconSvg}<span>${escapeHtml(button.text)}</span></button>`
}

/** Opens this scenario's metrics in the inspector. */
function metricsControl(scenario: Scenario): string {
  return panelButtonHtml({
    kind: 'metrics',
    scenarioId: scenario.id,
    iconSvg: METRICS_ICON_SVG,
    text: 'Metrics',
  })
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
      ${zoomControlsHtml(sequenceZoomShown(view))}
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
      ${panelControlsHtml(scenario)}
      <button type="button" class="seq-more-lanes" data-more-lanes aria-label="Show more lanes to the right">More lanes<span aria-hidden="true">&nbsp;→</span></button>
    </div>`
}

/**
 * The toolbar's side-panel group: Metrics. The Components view has the same one. Without metrics
 * (metrics off, or nothing timed) there is no button: a disabled one said why only on hover, and
 * on a phone it was a dead row.
 */
export function panelControlsHtml(scenario: Scenario): string {
  if (scenario.metrics.length === 0) return ''
  return `<div class="panel-controls" role="group" aria-label="Open in the side panel">${metricsControl(scenario)}</div>`
}

/**
 * One line under the toolbar explaining the `{}` marker, only when an arrow has a payload.
 * The verb follows the pointer (CSS swaps click for tap on touch). Screen only.
 */
function payloadLegendHtml(scenario: Scenario): string {
  if (!scenarioHasPayloads(scenario)) return ''
  return `<p class="payload-legend"><span class="payload-legend-key" aria-hidden="true">{}</span><span class="visually-hidden">An arrow marked with braces</span> has a payload: <span class="legend-click">click</span><span class="legend-tap">tap</span> the arrow to open it</p>`
}

/** A short sample of one arrow kind, as drawn in the diagram: line dash and tip. */
function arrowKeySvg(dash: string | null, tip: 'filled' | 'open'): string {
  const line = `<line class="arrow-key-line" x1="1" y1="6" x2="${tip === 'open' ? 25 : 22}" y2="6"${dash ? ` stroke-dasharray="${escapeAttr(dash)}"` : ''}/>`
  const head =
    tip === 'open'
      ? `<path class="arrow-key-line" d="M18 1 L27 6 L18 11" stroke-linejoin="round"/>`
      : `<path class="arrow-key-fill" d="M21 2 L29 6 L21 10 z"/>`
  return `<svg width="30" height="12" viewBox="0 0 30 12" aria-hidden="true" focusable="false">${line}${head}</svg>`
}

/**
 * The arrow key, when a scenario has async messages: call, reply and async side by side, so
 * the dotted line and open tip are explained in words, not left to colour or guesswork.
 */
export function arrowLegendHtml(scenario: Scenario): string {
  const types = new Set(scenario.events.flatMap((e) => (e.kind === 'message' ? [e.type] : [])))
  if (!types.has('ASYNCHRONOUS')) return ''
  const reply = messageArrowSpec('SYNCHRONOUS_RESPONSE')
  const async = messageArrowSpec('ASYNCHRONOUS')
  const keys = [
    `<span class="arrow-key">${arrowKeySvg(null, 'filled')}Call</span>`,
    types.has('SYNCHRONOUS_RESPONSE') ? `<span class="arrow-key">${arrowKeySvg(reply.dash, 'filled')}Reply</span>` : '',
    `<span class="arrow-key">${arrowKeySvg(async.dash, 'open')}Async (dotted, open tip)</span>`,
  ]
  return `<p class="arrow-legend">${keys.join('')}</p>`
}

/** The arrow key and the payload line share one row under the toolbar, wrapping when narrow. */
function legendsHtml(scenario: Scenario): string {
  const html = arrowLegendHtml(scenario) + payloadLegendHtml(scenario)
  return html ? `<div class="diagram-legends">${html}</div>` : ''
}

/** Continuous diagram: sticky participant header, section jump list, virtualised rows. */
export function renderDiagramHtml(scenario: Scenario, labelMaxWidth: number): string {
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
      ${legendsHtml(scenario)}
      ${textViewHtml(
        scenario,
        diagram.rows.map((row) => row.event),
        view.hidden,
      )}
      <div class="seq-stage">
        <div class="seq-scroll" data-scenario-id="${escapeAttr(scenario.id)}" tabindex="${diagramTab}" role="group" aria-label="Sequence diagram for ${escapeAttr(scenario.title)}">
          <div class="seq-sticky-header" style="width:${width * zoom}px">${headerHtml(scenario, frame, view.hidden, zoom, null)}</div>
          <div class="seq-more"><button type="button" class="seq-more-btn" data-more-lanes tabindex="-1" aria-label="Show more lanes to the right"><span>More lanes →</span></button></div>
          <div class="seq-spacer" style="height:${diagram.height * zoom}px;width:${width * zoom}px">
            <div class="seq-window"></div>
          </div>
        </div>
        <button type="button" class="seq-edge-tab" data-more-lanes tabindex="-1" aria-label="Show more lanes to the right" title="Show more lanes to the right">${EDGE_TAB_SVG}</button>
      </div>
    </div>`
}

/** The phone's edge tab: a chevron on the right end of the participant header row (#93). */
const EDGE_TAB_SVG =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4.5 2.5 L8 6 L4.5 9.5"/></svg>'

/** Upper bound for the printed width, from the unzoomed drawing width. */
function printWidthStyle(width: number): string {
  return `--seq-print-max:${Math.round(width * PRINT_MAX_UPSCALE)}px`
}

/** CSS pixels between the sticky header and a message brought into view for focus. */
const FOCUS_CLEARANCE_PX = 8

/** Scroll the arrow into view if needed, then focus its button. One tab stop. */
export function focusDiagramMessage(scrollport: HTMLElement, wanted: string): void {
  const scenarioId = scrollport.dataset.scenarioId
  if (!scenarioId) return
  const view = diagramView(scenarioId)
  const diagram = diagramState.mounted.get(scenarioId)
  // A hidden lane takes its arrows with it: focus the nearest drawn one, or the diagram itself.
  const messageId = diagram ? drawnFocusTarget(diagram.scenario.events, view.hidden, wanted) : wanted
  if (!messageId) {
    scrollport.focus({ preventScroll: true })
    return
  }
  view.activeMessageId = messageId
  const row = diagram?.rows.find((item) => item.event.kind === 'message' && item.event.id === messageId)
  diagramState.movingFocus = true
  try {
    if (row) {
      const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
      const cssHeader = header?.offsetHeight || HEADER_BLOCK_H * view.zoom
      // What of the drawing is on screen: before the diagram sticks to the page, not all of it.
      const unscaled = unscaledViewport({
        scrollTop: scrollport.scrollTop,
        viewportHeight: scrollport.clientHeight ? shownHeight(scrollport) : DEFAULT_VIEWPORT,
        headerHeight: cssHeader,
        zoom: view.zoom,
      })
      const labelY = row.y - MESSAGE_LABEL_RISE
      const viewBottom = unscaled.scrollTop + Math.max(0, unscaled.viewportHeight - unscaled.headerHeight)
      // The page moves with the drawing (page-scroll.ts): moving it here, at once, keeps the two in
      // step, so the message is on screen when it is focused and the page does not follow later.
      if (labelY < unscaled.scrollTop || row.y > viewBottom) {
        // A little clear of the sticky header: the focus ring sits outside the label's box.
        scrollDiagramToOffset(scrollport, Math.max(0, focusScrollTop(row.y, view.zoom) - FOCUS_CLEARANCE_PX))
      }
    }
    revealMessageX(scrollport, messageId)
    syncDiagramWindow(scrollport)
    // Its button reaches past the arrow and the label (the hit area), and before the diagram
    // sticks the drawing runs on below the window: move the page the rest of the way if needed.
    const placed = messageButton(scrollport, messageId)
    if (placed && keepOnPage(scrollport, placed, FOCUS_CLEARANCE_PX)) syncDiagramWindow(scrollport)
  } finally {
    diagramState.movingFocus = false
  }
  messageButton(scrollport, messageId)?.focus({ preventScroll: true })
}

function messageButton(scrollport: HTMLElement, messageId: string): HTMLButtonElement | null {
  return scrollport.querySelector<HTMLButtonElement>(`button.msg-open[data-message-id="${cssEscape(messageId)}"]`)
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
