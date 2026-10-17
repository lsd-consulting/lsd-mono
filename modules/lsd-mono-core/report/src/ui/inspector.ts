import type { MessageEvent, Metric } from '../types'
import { renderComponentDiagram } from '../lib/component-diagram'
import { STACKED_MAX_PX } from '../lib/media'
import { bindJsonBody } from './inspector-json'
import {
  INSPECTOR_MIN_PX,
  INSPECTOR_NARROW_PX,
  TIMING_VIEW_MIN_PX,
  bindInspectorWidth,
  naturalWidth,
} from './inspector-width'
import { revealBelowTopbar } from '../lib/reveal'
import type { ComponentGraph } from '../lib/component-graph'
import {
  componentLinkHtml,
  componentsBodyHtml,
  componentsMetaHtml,
  errorMetaHtml,
  messageMetaHtml,
  metricsBodyHtml,
  metricsMetaHtml,
  metricsTitle,
} from './inspector-views'

export { summaryPills } from './inspector-views'

export interface InspectorInvoker {
  scenarioId: string
  /** Set for a message. Absent when the panel is showing the component diagram or metrics. */
  messageId?: string
  kind?: 'message' | 'components' | 'metrics'
}

export interface MetricsView {
  /** Scenario title, shown as a pill. */
  heading: string
  metrics: Metric[]
  /** Timing view (summary, swim lanes, waterfall), shown above the metrics. */
  timingHtml?: string
}

export interface InspectorOptions {
  /** Full payload for a deferred message. Not called when the message already holds its whole payload. */
  loadPayload: (scenarioId: string, messageId: string) => Promise<unknown>
  /** Escape and the close control. Focus belongs back on the invoking arrow. */
  onClose: (invoker: InspectorInvoker | null) => void
  /** The JSON (or stack) shown in the panel changed: loaded, shown, or hidden. */
  onContent?: () => void
}

/** What the open panel shows, for the print copy in the scenario. */
export interface PanelPrintView {
  view: 'message' | 'components' | 'metrics' | 'error'
  title: string
  /** The panel's pills, already escaped. */
  metaHtml: string
  lead: string | null
  /** JSON or stack text while it is shown in the panel. Null when hidden or still loading. */
  text: string | null
}

export interface InspectorController {
  openMessage: (scenarioId: string, message: MessageEvent) => void
  /** Component diagram for one scenario, in this same panel. Drawn from messages already loaded. */
  openComponents: (scenarioId: string, graph: ComponentGraph, title: string) => void
  /** Scenario timing and metrics, in this same panel. No JSON or Copy. */
  openMetrics: (scenarioId: string, view: MetricsView) => void
  openError: (error: { status: string; headline: string; message: string; stack?: string }) => void
  close: () => void
  isOpen: () => boolean
  /** Null while the panel is closed. */
  printView: () => PanelPrintView | null
}

/**
 * Side panel. Not a dialog: the rest of the page stays active, and nothing sets aria-modal.
 * Focus moves into the panel. Escape and Close give it back to the arrow that opened it.
 * JSON is shown once its payload has loaded. Hide collapses it again.
 */
export function inspectorMarkup(): string {
  return `
    <aside id="inspector" class="inspector" hidden tabindex="-1" aria-labelledby="inspector-title">
      <div id="inspector-resize" class="inspector-resize" role="separator" aria-orientation="vertical" aria-label="Resize message panel" aria-valuemin="${INSPECTOR_MIN_PX}" aria-valuemax="900" aria-valuenow="${INSPECTOR_NARROW_PX}" tabindex="0"></div>
      <div class="inspector-head">
        <h2 id="inspector-title">Message</h2>
        <button type="button" class="icon-btn" id="inspector-copy" title="Copy payload">Copy</button>
        <button type="button" class="icon-btn" id="inspector-close" title="Close (Esc)" aria-label="Close">Close</button>
      </div>
      <div class="inspector-body">
        <div class="meta-row" id="inspector-meta"></div>
        <p id="inspector-lead" hidden></p>
        <div id="inspector-graph" hidden></div>
        <div id="inspector-metrics" hidden></div>
        <div class="json-row">
          <button type="button" id="inspector-json" aria-expanded="false" aria-controls="inspector-pre">Show JSON</button>
          <button type="button" id="inspector-json-expand" hidden aria-pressed="false" aria-controls="inspector-pre">Expand</button>
        </div>
        <pre id="inspector-pre" hidden></pre>
      </div>
    </aside>`
}

let onEscape: ((event: KeyboardEvent) => void) | null = null

export function bindInspector(doc: Document, options: InspectorOptions): InspectorController {
  const panel = doc.querySelector<HTMLElement>('#inspector')
  if (!panel) throw new Error('inspector markup is missing')
  const title = doc.querySelector<HTMLElement>('#inspector-title')!
  const meta = doc.querySelector<HTMLElement>('#inspector-meta')!
  const lead = doc.querySelector<HTMLElement>('#inspector-lead')!
  const toggle = doc.querySelector<HTMLButtonElement>('#inspector-json')!
  const expandBtn = doc.querySelector<HTMLButtonElement>('#inspector-json-expand')!
  const resize = doc.querySelector<HTMLElement>('#inspector-resize')!
  const pre = doc.querySelector<HTMLElement>('#inspector-pre')!
  const graphHost = doc.querySelector<HTMLElement>('#inspector-graph')!
  const metricsHost = doc.querySelector<HTMLElement>('#inspector-metrics')!
  const jsonRow = doc.querySelector<HTMLElement>('.json-row')!
  const copy = doc.querySelector<HTMLButtonElement>('#inspector-copy')!
  const closeBtn = doc.querySelector<HTMLButtonElement>('#inspector-close')!

  let invoker: InspectorInvoker | null = null
  let generation = 0
  const width = bindInspectorWidth(doc, { panel, expandBtn, resize })

  function shell(): HTMLElement | null {
    return panel!.closest('.shell')
  }

  function viewport(): number {
    return doc.defaultView?.innerWidth ?? 1200
  }

  function setOpen(open: boolean): void {
    if (open) width.apply(width.current())
    panel!.hidden = !open
    shell()?.classList.toggle('with-inspector', open)
    if (!open) return
    panel!.focus()
  }

  /** On a phone the panel is inline below the report: bring what just opened into view. */
  function revealOnPhone(content?: HTMLElement): void {
    if (viewport() <= STACKED_MAX_PX) revealBelowTopbar(panel!, content)
  }

  const json = bindJsonBody({
    toggle,
    pre,
    copy,
    current: () => generation,
    onContent: options.onContent,
    reveal: revealOnPhone,
  })

  /** Component diagram and metrics views. Only one is in the panel at a time. */
  const viewHosts = [graphHost, metricsHost]
  /** Graph behind the drawn component diagram, so a clicked link can list its messages. */
  let shownGraph: ComponentGraph | null = null

  /** List one link's interactions under the drawing and mark the link as selected. */
  function showLink(group: Element): void {
    const graph = shownGraph
    const list = graphHost.querySelector<HTMLElement>('.component-links')
    const edge = graph?.edges[Number(group.getAttribute('data-edge-index'))]
    if (!graph || !list || !edge) return
    graphHost.querySelectorAll('.edge-group.is-selected').forEach((el) => el.classList.remove('is-selected'))
    group.classList.add('is-selected')
    list.innerHTML = componentLinkHtml(graph, edge)
  }

  graphHost.addEventListener('click', (event) => {
    const group = (event.target as Element | null)?.closest?.('.edge-group')
    if (group) showLink(group)
  })
  graphHost.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const group = (event.target as Element | null)?.closest?.('.edge-group')
    if (!group) return
    event.preventDefault()
    showLink(group)
  })

  function clearViews(): void {
    for (const host of viewHosts) {
      host.hidden = true
      host.replaceChildren()
    }
  }

  function showMessageChrome(): void {
    clearViews()
    copy.hidden = false
    jsonRow.hidden = false
  }

  /** A view with no payload: no JSON row, no Copy. */
  function showViewChrome(host: HTMLElement): void {
    copy.hidden = true
    jsonRow.hidden = true
    toggle.hidden = true
    expandBtn.hidden = true
    pre.hidden = true
    pre.textContent = ''
    lead.hidden = true
    clearViews()
    host.hidden = false
  }

  function close(): void {
    if (panel!.hidden) return
    generation += 1
    json.stop()
    const back = invoker
    invoker = null
    setOpen(false)
    options.onClose(back)
  }

  function begin(next: InspectorInvoker | null, label = 'JSON'): number {
    generation += 1
    invoker = next
    // Which view is showing. The panel never prints; main.ts prints a copy of this view in its scenario.
    panel!.dataset.view = next ? (next.kind ?? 'message') : 'error'
    json.reset(label)
    expandBtn.hidden = false
    lead.hidden = true
    lead.textContent = ''
    showMessageChrome()
    width.reload()
    setOpen(true)
    return generation
  }

  const controller: InspectorController = {
    isOpen: () => !panel.hidden,
    close,
    printView() {
      if (panel.hidden) return null
      return {
        view: (panel.dataset.view ?? 'message') as PanelPrintView['view'],
        title: title.textContent ?? '',
        metaHtml: meta.innerHTML.trim(),
        lead: lead.hidden ? null : lead.textContent,
        text: pre.hidden ? null : pre.textContent,
      }
    },
    openMessage(scenarioId, message) {
      const token = begin({ scenarioId, messageId: message.id, kind: 'message' })
      json.revealWhenShown()
      title.textContent = message.label
      meta.innerHTML = messageMetaHtml(scenarioId, message)
      const payload = message.payloadId ? options.loadPayload(scenarioId, message.id) : Promise.resolve(message.data)
      json.load(payload, token, () => {
        lead.hidden = false
        lead.textContent = 'Could not load the payload.'
      })
    },
    openComponents(scenarioId, graph, heading) {
      begin({ scenarioId, kind: 'components' })
      json.stop()
      title.textContent = 'Component diagram'
      meta.innerHTML = componentsMetaHtml(graph, heading)
      showViewChrome(graphHost)
      const drawn = renderComponentDiagram(graph, heading)
      shownGraph = graph
      graphHost.innerHTML = componentsBodyHtml(drawn.svg, graph)
      width.fit(drawn.width)
      revealOnPhone()
    },
    openMetrics(scenarioId, view) {
      begin({ scenarioId, kind: 'metrics' })
      json.stop()
      title.textContent = metricsTitle(view)
      meta.innerHTML = metricsMetaHtml(view)
      showViewChrome(metricsHost)
      metricsHost.innerHTML = metricsBodyHtml(scenarioId, view)
      width.fit(Math.max(naturalWidth(metricsHost), view.timingHtml ? TIMING_VIEW_MIN_PX : 0))
      revealOnPhone()
    },
    openError(error) {
      const token = begin(null, 'stack')
      title.textContent = error.headline
      meta.innerHTML = errorMetaHtml(error)
      lead.hidden = false
      lead.textContent = error.message
      if (error.stack) json.loaded(error.stack, token)
      else json.none()
    },
  }

  closeBtn.addEventListener('click', () => close())
  if (onEscape) doc.removeEventListener('keydown', onEscape)
  onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || panel.hidden) return
    event.preventDefault()
    close()
  }
  doc.addEventListener('keydown', onEscape)
  return controller
}

/**
 * Click, Enter, and Space on an arrow button open the same inspector.
 * Returns true when this event was that activation.
 */
export function delegateMessageOpen(
  event: Event,
  lookup: (node: Element) => { scenarioId: string; message: MessageEvent } | null,
  open: (scenarioId: string, message: MessageEvent) => void,
): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const button = target.closest('button.msg-open')
  if (!button) return false
  if (event.type === 'keydown') {
    const key = (event as KeyboardEvent).key
    if (key !== 'Enter' && key !== ' ') return false
    event.preventDefault()
  } else if (event.type !== 'click') {
    return false
  }
  const found = lookup(button)
  if (!found) return false
  open(found.scenarioId, found.message)
  return true
}
