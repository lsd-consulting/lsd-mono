// The side panel's shell (#103): its sizing, opening and closing, the close button and the
// JSON body the message and error views share. Escape reaches close() through the key router.
import { STACKED_MAX_PX } from '../lib/media'
import { revealBelowTopbar } from '../lib/reveal'
import { bindJsonBody } from './inspector-json'
import { bindJsonMarks } from './json-marks'
import { bindInspectorWidth } from './inspector-width'
import {
  NO_FOCUS_RETURN,
  type FocusReturn,
  type InspectorInvoker,
  type PanelShell,
  type PanelView,
} from './inspector-view'

export interface PanelShellOptions {
  onClose: (invoker: InspectorInvoker | null, focus: FocusReturn) => void
  onContent?: () => void
  findQuery?: (scenarioId: string) => string
}

/** What the open panel shows, for the print copy in the scenario. */
export interface PanelPrintView {
  view: 'message' | 'link' | 'metrics' | 'error'
  title: string
  /** The panel's pills, already escaped. */
  metaHtml: string
  lead: string | null
  /** JSON or stack text while it is shown in the panel. Null when hidden or still loading. */
  text: string | null
}

export interface PanelShellControl {
  /** For the views. */
  shell: PanelShell
  linkHost: HTMLElement
  metricsHost: HTMLElement
  close: () => void
  isOpen: () => boolean
  printView: () => PanelPrintView | null
  refreshFind: () => void
}

/**
 * Bind the panel's shell to the markup. The shell remembers which view is showing and its
 * invoker; a view that opens over another closes it first, and closing asks the view showing
 * where focus goes.
 */
export function bindPanelShell(doc: Document, options: PanelShellOptions): PanelShellControl {
  const panel = doc.querySelector<HTMLElement>('#inspector')
  if (!panel) throw new Error('inspector markup is missing')
  const title = doc.querySelector<HTMLElement>('#inspector-title')!
  const meta = doc.querySelector<HTMLElement>('#inspector-meta')!
  const lead = doc.querySelector<HTMLElement>('#inspector-lead')!
  const toggle = doc.querySelector<HTMLButtonElement>('#inspector-json')!
  const expandBtn = doc.querySelector<HTMLButtonElement>('#inspector-json-expand')!
  const pre = doc.querySelector<HTMLElement>('#inspector-pre')!
  const copy = doc.querySelector<HTMLButtonElement>('#inspector-copy')!
  const resize = doc.querySelector<HTMLElement>('#inspector-resize')!
  const body = panelBody(doc)

  let invoker: InspectorInvoker | null = null
  let showing: PanelView | null = null
  let generation = 0
  const width = bindInspectorWidth(doc, { panel, expandBtn, resize })
  const viewport = (): number => doc.defaultView?.innerWidth ?? 1200

  function setOpen(open: boolean, focus = true): void {
    // A view's width, not a person's: set at once (#90).
    if (open) width.apply(width.current(), true)
    panel!.hidden = !open
    panel!.closest('.shell')?.classList.toggle('with-inspector', open)
    if (open && focus) panel!.focus()
  }

  function revealOnPhone(content?: HTMLElement): void {
    if (viewport() <= STACKED_MAX_PX) revealBelowTopbar(panel!, content)
  }

  const findBox = doc.querySelector<HTMLElement>('#inspector-find')!
  const json = bindJsonBody({
    toggle,
    pre,
    copy,
    current: () => generation,
    onContent: options.onContent,
    reveal: revealOnPhone,
    marks: bindJsonMarks({
      pre,
      box: findBox,
      count: findBox.querySelector<HTMLElement>('.json-find-count')!,
      prev: findBox.querySelector<HTMLButtonElement>('[data-json-step="prev"]')!,
      next: findBox.querySelector<HTMLButtonElement>('[data-json-step="next"]')!,
    }),
    query: () => (invoker?.kind === 'message' && options.findQuery ? options.findQuery(invoker.scenarioId) : ''),
  })

  const shell: PanelShell = {
    doc,
    panel,
    title,
    meta,
    lead,
    json,
    width,
    viewport,
    revealOnPhone,
    begin(view, next, label = 'JSON', focus = true) {
      if (showing && showing !== view) showing.close()
      showing = view
      generation += 1
      invoker = next
      // Which view is showing. The panel never prints; main.ts prints a copy of this view in its scenario.
      panel.dataset.view = next ? (next.kind ?? 'message') : 'error'
      json.reset(label)
      body.forMessage()
      width.reload()
      setOpen(true, focus)
      return generation
    },
    showViewChrome: (host) => body.forView(host),
  }

  function close(): void {
    if (panel!.hidden) return
    generation += 1
    json.stop()
    const back = invoker
    const view = showing
    view?.close()
    invoker = null
    showing = null
    setOpen(false)
    options.onClose(back, view?.focusReturn(back) ?? NO_FOCUS_RETURN)
  }

  doc.querySelector<HTMLButtonElement>('#inspector-close')!.addEventListener('click', () => close())

  return {
    shell,
    linkHost: body.linkHost,
    metricsHost: body.metricsHost,
    close,
    isOpen: () => !panel.hidden,
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
    refreshFind() {
      if (!panel.hidden) json.refreshMarks()
    },
  }
}

/** Which parts of the panel's body show: a message's (pills, lead, JSON row, Copy) or one view's host. */
function panelBody(doc: Document) {
  const lead = doc.querySelector<HTMLElement>('#inspector-lead')!
  const toggle = doc.querySelector<HTMLButtonElement>('#inspector-json')!
  const expandBtn = doc.querySelector<HTMLButtonElement>('#inspector-json-expand')!
  const pre = doc.querySelector<HTMLElement>('#inspector-pre')!
  const jsonRow = doc.querySelector<HTMLElement>('.json-row')!
  const copy = doc.querySelector<HTMLButtonElement>('#inspector-copy')!
  const linkHost = doc.querySelector<HTMLElement>('#inspector-link')!
  const metricsHost = doc.querySelector<HTMLElement>('#inspector-metrics')!

  /** Component diagram and metrics views. Only one is in the panel at a time. */
  function clearViews(): void {
    for (const host of [linkHost, metricsHost]) {
      host.hidden = true
      host.replaceChildren()
    }
  }

  return {
    linkHost,
    metricsHost,
    forMessage(): void {
      expandBtn.hidden = false
      lead.hidden = true
      lead.textContent = ''
      clearViews()
      copy.hidden = false
      jsonRow.hidden = false
    },
    /** A view with no payload: no JSON row, no Copy. */
    forView(host: HTMLElement): void {
      copy.hidden = true
      jsonRow.hidden = true
      toggle.hidden = true
      expandBtn.hidden = true
      pre.hidden = true
      pre.textContent = ''
      lead.hidden = true
      clearViews()
      host.hidden = false
    },
  }
}
