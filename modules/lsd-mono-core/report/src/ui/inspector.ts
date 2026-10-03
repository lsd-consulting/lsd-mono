import type { MessageEvent } from '../types'
import { pretty } from './format'

export interface InspectorInvoker {
  scenarioId: string
  messageId: string
}

export interface InspectorOptions {
  /** Full payload for a deferred message. Not called when the message already holds its whole payload. */
  loadPayload: (scenarioId: string, messageId: string) => Promise<unknown>
  /** Escape and the close control. Focus belongs back on the invoking arrow. */
  onClose: (invoker: InspectorInvoker | null) => void
}

export interface InspectorController {
  openMessage: (scenarioId: string, message: MessageEvent) => void
  openError: (error: { status: string; headline: string; message: string; stack?: string }) => void
  close: () => void
  isOpen: () => boolean
}

/**
 * Side panel. Not a dialog: the rest of the page stays active, and nothing sets aria-modal.
 * Focus moves into the panel. Escape and Close give it back to the arrow that opened it.
 */
export function inspectorMarkup(): string {
  return `
    <aside id="inspector" class="inspector" hidden tabindex="-1" aria-labelledby="inspector-title">
      <div class="inspector-head">
        <h2 id="inspector-title">Message</h2>
        <button type="button" class="icon-btn" id="inspector-copy" title="Copy payload">Copy</button>
        <button type="button" class="icon-btn" id="inspector-close" title="Close (Esc)" aria-label="Close">Close</button>
      </div>
      <div class="inspector-body">
        <div class="meta-row" id="inspector-meta"></div>
        <p id="inspector-lead" hidden></p>
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
  const pre = doc.querySelector<HTMLElement>('#inspector-pre')!
  const copy = doc.querySelector<HTMLButtonElement>('#inspector-copy')!
  const closeBtn = doc.querySelector<HTMLButtonElement>('#inspector-close')!

  let invoker: InspectorInvoker | null = null
  let generation = 0
  let pending: Promise<unknown> = Promise.resolve(undefined)
  let cached: unknown = undefined
  let ready = false
  let jsonLabel = 'JSON'

  function shell(): HTMLElement | null {
    return panel!.closest('.shell')
  }

  function setOpen(open: boolean): void {
    panel!.hidden = !open
    shell()?.classList.toggle('with-inspector', open)
    if (!open) return
    panel!.focus()
  }

  function setJsonWide(wide: boolean): void {
    shell()?.classList.toggle('inspector-json-wide', wide)
    panel!.classList.toggle('inspector-json-wide', wide)
    expandBtn.setAttribute('aria-pressed', wide ? 'true' : 'false')
    expandBtn.textContent = wide ? 'Shrink' : 'Expand'
    expandBtn.setAttribute('aria-label', wide ? 'Shrink JSON' : 'Expand JSON')
  }

  function collapse(): void {
    pre.hidden = true
    pre.textContent = ''
    toggle.setAttribute('aria-expanded', 'false')
    toggle.textContent = `Show ${jsonLabel}`
    expandBtn.hidden = true
    setJsonWide(false)
  }

  async function payloadText(): Promise<string> {
    const value = ready ? cached : await pending
    if (value === undefined) return '(no payload)'
    return typeof value === 'string' ? value : pretty(value)
  }

  function close(): void {
    if (panel!.hidden) return
    generation += 1
    const back = invoker
    invoker = null
    setJsonWide(false)
    setOpen(false)
    options.onClose(back)
  }

  function begin(next: InspectorInvoker | null): number {
    generation += 1
    invoker = next
    ready = false
    cached = undefined
    collapse()
    lead.hidden = true
    lead.textContent = ''
    toggle.hidden = false
    setOpen(true)
    return generation
  }

  const controller: InspectorController = {
    isOpen: () => !panel.hidden,
    close,
    openMessage(scenarioId, message) {
      const token = begin({ scenarioId, messageId: message.id })
      jsonLabel = 'JSON'
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
        },
        () => {
          if (token !== generation) return
          cached = undefined
          ready = true
          lead.hidden = false
          lead.textContent = 'Could not load the payload.'
        },
      )
    },
    openError(error) {
      begin(null)
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
        collapse()
      } else {
        toggle.hidden = true
        pending = Promise.resolve(undefined)
        ready = true
      }
    },
  }

  closeBtn.addEventListener('click', () => close())
  toggle.addEventListener('click', async () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true'
    if (expanded) {
      collapse()
      return
    }
    const token = generation
    let text: string
    try {
      text = await payloadText()
    } catch {
      text = '(no payload)'
    }
    if (token !== generation) return
    pre.textContent = text
    pre.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    toggle.textContent = `Hide ${jsonLabel}`
    expandBtn.hidden = false
  })
  expandBtn.addEventListener('click', () => {
    setJsonWide(expandBtn.getAttribute('aria-pressed') !== 'true')
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
