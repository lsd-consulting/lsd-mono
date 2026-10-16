import type { MessageEvent, Metric } from '../types'
import { renderComponentDiagram } from '../lib/component-diagram'
import type { ComponentGraph } from '../lib/component-graph'
import { pretty } from './format'
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

/** Session-only. A refresh starts from the narrow column again. */
export const INSPECTOR_WIDTH_KEY = 'lsd-report-inspector-width'
/** Current narrow column, in px. Drag does not go below this floor's sibling minimum. */
export const INSPECTOR_NARROW_PX = 380
export const INSPECTOR_MIN_PX = 260

export function inspectorWidthLimits(viewport: number): { min: number; max: number; expand: number } {
  const max = Math.max(INSPECTOR_MIN_PX, Math.floor(viewport * 0.9))
  const expand = Math.min(max, Math.max(520, Math.round(viewport * 0.7)))
  return { min: INSPECTOR_MIN_PX, max, expand }
}

/** At and below this width the panel stacks under the report at full width (app.css). */
export const INSPECTOR_STACKED_PX = 860
/** Room around a view's content: the panel's padding and a little air. */
export const INSPECTOR_VIEW_GUTTER_PX = 40

/**
 * Width that fits a component diagram or metrics view whose content is [content] px wide:
 * never narrower than the message column, and at most half the viewport so the diagram
 * beside it keeps room. A wider drawing scrolls inside the panel, or the user drags it wider.
 */
export function fitViewWidth(content: number, viewport: number): number {
  const { expand } = inspectorWidthLimits(viewport)
  const cap = Math.max(INSPECTOR_NARROW_PX, Math.min(expand, Math.round(viewport * INSPECTOR_VIEW_MAX_SHARE)))
  const want = Math.ceil(content) + INSPECTOR_VIEW_GUTTER_PX
  return clampInspectorWidth(Math.min(cap, Math.max(INSPECTOR_NARROW_PX, want)), viewport)
}

/** Share of the viewport an auto-sized view may take. */
export const INSPECTOR_VIEW_MAX_SHARE = 0.5
/** Timing swim lanes and waterfall stretch to fit, so they ask for at least this much room. */
export const TIMING_VIEW_MIN_PX = 480

/** The natural width of [host]'s content, laid out without the panel's width limit. */
export function naturalWidth(host: HTMLElement): number {
  const prior = host.style.width
  host.style.width = 'max-content'
  const measured = Math.max(host.scrollWidth, host.getBoundingClientRect().width)
  host.style.width = prior
  return measured
}

export function clampInspectorWidth(px: number, viewport: number): number {
  const { min, max } = inspectorWidthLimits(viewport)
  return Math.round(Math.min(max, Math.max(min, px)))
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
  let pending: Promise<unknown> = Promise.resolve(undefined)
  let cached: unknown = undefined
  let ready = false
  let jsonLabel = 'JSON'
  let showJson = false
  /** Set when an arrow opens: on a phone its JSON is scrolled into view once it shows. */
  let revealJson = false
  let width = readWidth(doc)

  function shell(): HTMLElement | null {
    return panel!.closest('.shell')
  }

  function viewport(): number {
    return doc.defaultView?.innerWidth ?? 1200
  }

  function setOpen(open: boolean): void {
    if (open) applyWidth(width)
    panel!.hidden = !open
    shell()?.classList.toggle('with-inspector', open)
    if (!open) return
    panel!.focus()
  }

  function applyWidth(px: number): void {
    width = clampInspectorWidth(px, viewport())
    shell()?.style.setProperty('--inspector-w', `${width}px`)
    const wide = width > INSPECTOR_NARROW_PX + 16
    shell()?.classList.toggle('inspector-json-wide', wide)
    panel!.classList.toggle('inspector-json-wide', wide)
    expandBtn.setAttribute('aria-pressed', wide ? 'true' : 'false')
    expandBtn.textContent = wide ? 'Shrink' : 'Expand'
    expandBtn.setAttribute('aria-label', wide ? 'Shrink JSON' : 'Expand JSON')
    const limits = inspectorWidthLimits(viewport())
    resize.setAttribute('aria-valuemin', String(limits.min))
    resize.setAttribute('aria-valuemax', String(limits.max))
    resize.setAttribute('aria-valuenow', String(width))
  }

  /**
   * Size the panel to the open view's content. The saved width is untouched, so the next
   * message opens at the column the user chose, and a drag still resizes from here. On a
   * phone the panel is the page width already, so nothing changes.
   */
  function fitView(content: number): void {
    if (viewport() <= INSPECTOR_STACKED_PX) return
    applyWidth(fitViewWidth(content, viewport()))
  }

  function persistWidth(): void {
    try {
      doc.defaultView?.sessionStorage.setItem(INSPECTOR_WIDTH_KEY, String(width))
    } catch {
      /* private mode or a test document without storage */
    }
  }

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

  function collapseJson(): void {
    showJson = false
    pre.hidden = true
    pre.textContent = ''
    toggle.setAttribute('aria-expanded', 'false')
    toggle.textContent = `Show ${jsonLabel}`
    options.onContent?.()
  }

  async function payloadText(): Promise<string> {
    const value = ready ? cached : await pending
    if (value === undefined) return '(no payload)'
    return typeof value === 'string' ? value : pretty(value)
  }

  async function showJsonBody(token: number): Promise<void> {
    let text: string
    try {
      text = await payloadText()
    } catch {
      text = '(no payload)'
    }
    if (token !== generation || !showJson) return
    pre.textContent = text
    pre.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    toggle.textContent = `Hide ${jsonLabel}`
    options.onContent?.()
    if (revealJson) {
      revealJson = false
      if (viewport() <= INSPECTOR_STACKED_PX) revealBelowTopbar(panel!, pre)
    }
  }

  function close(): void {
    if (panel!.hidden) return
    generation += 1
    showJson = false
    const back = invoker
    invoker = null
    setOpen(false)
    options.onClose(back)
  }

  function begin(next: InspectorInvoker | null): number {
    generation += 1
    invoker = next
    // Which view is showing. The panel never prints; main.ts prints a copy of this view in its scenario.
    panel!.dataset.view = next ? (next.kind ?? 'message') : 'error'
    ready = false
    cached = undefined
    showJson = true
    revealJson = false
    pre.hidden = true
    pre.textContent = ''
    toggle.hidden = false
    toggle.setAttribute('aria-expanded', 'false')
    toggle.textContent = `Show ${jsonLabel}`
    expandBtn.hidden = false
    lead.hidden = true
    lead.textContent = ''
    showMessageChrome()
    width = readWidth(doc)
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
      jsonLabel = 'JSON'
      revealJson = true
      toggle.textContent = `Show ${jsonLabel}`
      title.textContent = message.label
      meta.innerHTML = messageMetaHtml(scenarioId, message)
      pending = message.payloadId ? options.loadPayload(scenarioId, message.id) : Promise.resolve(message.data)
      void pending.then(
        (value) => {
          if (token !== generation) return
          cached = value
          ready = true
          void showJsonBody(token)
        },
        () => {
          if (token !== generation) return
          cached = undefined
          ready = true
          lead.hidden = false
          lead.textContent = 'Could not load the payload.'
          void showJsonBody(token)
        },
      )
    },
    openComponents(scenarioId, graph, heading) {
      begin({ scenarioId, kind: 'components' })
      showJson = false
      title.textContent = 'Component diagram'
      meta.innerHTML = componentsMetaHtml(graph, heading)
      showViewChrome(graphHost)
      const drawn = renderComponentDiagram(graph, heading)
      shownGraph = graph
      graphHost.innerHTML = componentsBodyHtml(drawn.svg, graph)
      fitView(drawn.width)
    },
    openMetrics(scenarioId, view) {
      begin({ scenarioId, kind: 'metrics' })
      showJson = false
      title.textContent = metricsTitle(view)
      meta.innerHTML = metricsMetaHtml(view)
      showViewChrome(metricsHost)
      metricsHost.innerHTML = metricsBodyHtml(scenarioId, view)
      fitView(Math.max(naturalWidth(metricsHost), view.timingHtml ? TIMING_VIEW_MIN_PX : 0))
    },
    openError(error) {
      const token = begin(null)
      jsonLabel = 'stack'
      title.textContent = error.headline
      meta.innerHTML = errorMetaHtml(error)
      lead.hidden = false
      lead.textContent = error.message
      if (error.stack) {
        pending = Promise.resolve(error.stack)
        cached = error.stack
        ready = true
        toggle.textContent = `Show ${jsonLabel}`
        void showJsonBody(token)
      } else {
        showJson = false
        toggle.hidden = true
        pending = Promise.resolve(undefined)
        ready = true
      }
    },
  }

  closeBtn.addEventListener('click', () => close())
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true'
    if (expanded) {
      collapseJson()
      return
    }
    showJson = true
    void showJsonBody(generation)
  })
  expandBtn.addEventListener('click', () => {
    const wide = expandBtn.getAttribute('aria-pressed') === 'true'
    const limits = inspectorWidthLimits(viewport())
    applyWidth(wide ? INSPECTOR_NARROW_PX : limits.expand)
    persistWidth()
  })
  const copyPayload = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(await payloadText())
      copy.textContent = 'Copied'
      setTimeout(() => {
        copy.textContent = 'Copy'
      }, 1200)
    } catch {
      /* clipboard may be unavailable; the payload is still in the panel */
    }
  }
  copy.addEventListener('click', () => void copyPayload())

  bindResize(doc, resize, {
    shell,
    width: () => width,
    apply: applyWidth,
    persist: persistWidth,
  })

  if (onEscape) doc.removeEventListener('keydown', onEscape)
  onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || panel.hidden) return
    event.preventDefault()
    close()
  }
  doc.addEventListener('keydown', onEscape)
  return controller
}

/** Air between the sticky top bar and what is scrolled under it. */
const REVEAL_GAP_PX = 8

/**
 * On a phone the panel sits inline below the report, so a payload can open below the screen.
 * Scroll the page so the JSON shows below the sticky top bar: from the panel's head when the
 * head and the start of the JSON fit together, else from the JSON's own row. Nothing moves
 * when the JSON already starts on screen. Smooth unless the user asks for reduced motion.
 */
export function revealBelowTopbar(panel: HTMLElement, pre: HTMLElement): void {
  const win = panel.ownerDocument.defaultView
  if (!win) return
  const bar = Number.parseFloat(getComputedStyle(panel.ownerDocument.documentElement).getPropertyValue('--topbar-h'))
  const top = (Number.isFinite(bar) ? bar : 0) + REVEAL_GAP_PX
  const room = win.innerHeight - top
  const json = pre.getBoundingClientRect()
  const show = Math.min(json.height, room / 3)
  if (json.top >= top && json.top + show <= win.innerHeight) return
  const head = panel.getBoundingClientRect().top
  const row = (pre.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().top ?? json.top
  const anchor = json.top + show - head <= room ? head : row
  const reduce = typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches
  win.scrollTo({ top: Math.max(0, win.scrollY + anchor - top), behavior: reduce ? 'auto' : 'smooth' })
}

function readWidth(doc: Document): number {
  try {
    const raw = doc.defaultView?.sessionStorage.getItem(INSPECTOR_WIDTH_KEY)
    const parsed = raw == null ? NaN : Number(raw)
    if (!Number.isFinite(parsed)) return INSPECTOR_NARROW_PX
    return clampInspectorWidth(parsed, doc.defaultView?.innerWidth ?? 1200)
  } catch {
    return INSPECTOR_NARROW_PX
  }
}

function bindResize(
  doc: Document,
  handle: HTMLElement,
  controls: {
    shell: () => HTMLElement | null
    width: () => number
    apply: (px: number) => void
    persist: () => void
  },
): void {
  let dragging = false
  let originX = 0
  let originW = 0

  function onMove(event: PointerEvent): void {
    if (!dragging) return
    controls.apply(originW + (originX - event.clientX))
  }

  function onUp(): void {
    if (!dragging) return
    dragging = false
    controls.shell()?.classList.remove('inspector-resizing')
    controls.persist()
    doc.removeEventListener('pointermove', onMove)
    doc.removeEventListener('pointerup', onUp)
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragging = true
    originX = event.clientX
    originW = controls.width()
    controls.shell()?.classList.add('inspector-resizing')
    doc.addEventListener('pointermove', onMove)
    doc.addEventListener('pointerup', onUp)
  })

  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 80 : 24
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = controls.width() + step
    else if (event.key === 'ArrowRight') next = controls.width() - step
    else if (event.key === 'Home') next = INSPECTOR_MIN_PX
    else if (event.key === 'End') next = inspectorWidthLimits(doc.defaultView?.innerWidth ?? 1200).max
    if (next == null) return
    event.preventDefault()
    controls.apply(next)
    controls.persist()
  })
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
