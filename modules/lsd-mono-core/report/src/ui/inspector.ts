import type { MessageEvent } from '../types'
import { renderComponentDiagram } from '../lib/component-diagram'
import type { ComponentGraph } from '../lib/component-graph'
import { pretty } from './format'

export interface InspectorInvoker {
  scenarioId: string
  /** Set for a message. Absent when the panel is showing the component diagram. */
  messageId?: string
  kind?: 'message' | 'components'
}

export interface InspectorOptions {
  /** Full payload for a deferred message. Not called when the message already holds its whole payload. */
  loadPayload: (scenarioId: string, messageId: string) => Promise<unknown>
  /** Escape and the close control. Focus belongs back on the invoking arrow. */
  onClose: (invoker: InspectorInvoker | null) => void
}

export interface InspectorController {
  openMessage: (scenarioId: string, message: MessageEvent) => void
  /** Component diagram for one scenario, in this same panel. Drawn from messages already loaded. */
  openComponents: (scenarioId: string, graph: ComponentGraph, title: string) => void
  openError: (error: { status: string; headline: string; message: string; stack?: string }) => void
  close: () => void
  isOpen: () => boolean
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

  function persistWidth(): void {
    try {
      doc.defaultView?.sessionStorage.setItem(INSPECTOR_WIDTH_KEY, String(width))
    } catch {
      /* private mode or a test document without storage */
    }
  }

  function showMessageChrome(): void {
    graphHost.hidden = true
    graphHost.replaceChildren()
    copy.hidden = false
    jsonRow.hidden = false
  }

  function showGraphChrome(): void {
    copy.hidden = true
    jsonRow.hidden = true
    toggle.hidden = true
    expandBtn.hidden = true
    pre.hidden = true
    pre.textContent = ''
    lead.hidden = true
    graphHost.hidden = false
  }

  function collapseJson(): void {
    showJson = false
    pre.hidden = true
    pre.textContent = ''
    toggle.setAttribute('aria-expanded', 'false')
    toggle.textContent = `Show ${jsonLabel}`
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
    ready = false
    cached = undefined
    showJson = true
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
    openMessage(scenarioId, message) {
      const token = begin({ scenarioId, messageId: message.id, kind: 'message' })
      jsonLabel = 'JSON'
      toggle.textContent = `Show ${jsonLabel}`
      title.textContent = message.label
      meta.innerHTML = `
        <span class="pill">${escapeHtml(message.type)}</span>
        <span class="pill">${escapeHtml(message.from)} → ${escapeHtml(message.to)}</span>
        ${message.durationMs != null ? `<span class="pill">${message.durationMs} ms</span>` : ''}
        ${summaryPills(message.data)}
        <span class="pill">${escapeHtml(scenarioId)}</span>`
      pending = message.payloadId
        ? options.loadPayload(scenarioId, message.id)
        : Promise.resolve(message.data)
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
      const nodes = graph.nodes.length
      const links = graph.edges.length
      meta.innerHTML = nodes
        ? `<span class="pill">${nodes} ${nodes === 1 ? 'component' : 'components'}</span>
        <span class="pill">${links} ${links === 1 ? 'link' : 'links'}</span>
        <span class="pill">${escapeHtml(heading)}</span>`
        : `<span class="pill">Nothing to draw</span>
        <span class="pill">${escapeHtml(heading)}</span>`
      showGraphChrome()
      const drawn = renderComponentDiagram(graph, heading)
      graphHost.innerHTML = drawn.svg
      // Widen for this view only when the drawing needs it. The saved width is untouched,
      // so the next message opens at the column the user chose.
      const fit = drawn.width + 40
      if (fit > width) applyWidth(Math.min(fit, inspectorWidthLimits(viewport()).expand))
    },
    openError(error) {
      const token = begin(null)
      jsonLabel = 'stack'
      title.textContent = error.headline
      meta.innerHTML = `
        <span class="pill">${escapeHtml(error.status)}</span>
        <span class="pill">${escapeHtml(error.headline)}</span>`
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
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(await payloadText())
      copy.textContent = 'Copied'
      setTimeout(() => {
        copy.textContent = 'Copy'
      }, 1200)
    } catch {
      /* clipboard may be unavailable; the payload is still in the panel */
    }
  })

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

export function summaryPills(data: unknown): string {
  if (!isRecord(data)) return ''
  const pills: string[] = []
  if (typeof data.method === 'string' && data.method) pills.push(`<span class="pill">${escapeHtml(data.method)}</span>`)
  if (typeof data.path === 'string' && data.path) pills.push(`<span class="pill">${escapeHtml(data.path)}</span>`)
  if (data.status != null && data.status !== '') pills.push(`<span class="pill">${escapeHtml(String(data.status))}</span>`)
  return pills.join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
