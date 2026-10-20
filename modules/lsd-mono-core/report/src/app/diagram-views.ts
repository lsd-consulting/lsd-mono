// Switching a scenario's diagram between its Sequence and Components views (#105): the tabs,
// the URL, the status line, and keeping each view's place while the other is shown. The
// Components view's links open the side panel, and "Show in sequence" comes back from there.
import type { MessageEvent, Scenario } from '../types'
import { type DiagramViewName, diagramViewHeading, diagramViewHint } from '../lib/diagram-view-names'
import { mountedComponents } from '../lib/component-view'
import { componentZoom } from '../lib/component-zoom'
import { diagramState } from '../lib/diagram/state'
import { scrollDiagramToOffset, sizeStage } from '../lib/diagram/page-scroll'
import { diagramView, findMessage, focusDiagramMessage, syncDiagramWindow } from '../lib/sequence-diagram'
import { zoomLabel } from '../lib/diagram-view'
import { cssEscape } from '../lib/escape'
import { usage } from '../lib/usage-ping'
import { openMessage, syncWithPanel } from './panel'
import { writeScenarioHash } from './url-hash'
import { session } from './context'

/** Each view's scrollport's place while the other is shown: hiding it loses its scroll. */
const places = new WeakMap<HTMLElement, { top: number; left: number }>()

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** What the status line says when [view] is selected: the view, its counts and its zoom. */
export function viewAnnouncement(scenario: Scenario, view: DiagramViewName): string {
  if (view === 'components') {
    const drawn = mountedComponents(scenario.id)
    const nodes = drawn?.graph.nodes.length ?? 0
    const links = drawn?.graph.edges.length ?? 0
    return `Component diagram, ${count(nodes, 'component')}, ${count(links, 'link')}, zoom ${zoomLabel(componentZoom(scenario.id).zoom)}`
  }
  const messages = scenario.events.filter((event) => event.kind === 'message').length
  return `Sequence diagram, ${count(messages, 'message')}, zoom ${zoomLabel(diagramView(scenario.id).zoom)}`
}

function shownCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#main .scenario-card')
}

function shownScenario(): Scenario | undefined {
  return session.report.scenarios.find((item) => item.id === session.renderedId)
}

/**
 * Show [view] in the shown scenario's card, and remember it for the next scenario. The other
 * view keeps its zoom, scroll, Find, hidden lanes and focused message for when it comes back.
 * Focus stays where it is (on the tab, after a tab press). [announce] says the view in the status line.
 */
export function showDiagramView(view: DiagramViewName, announce = true): void {
  const card = shownCard()
  const scenario = shownScenario()
  const area = card?.querySelector<HTMLElement>('.diagram-panel')
  if (!card || !scenario || !area) return
  const pane = (name: DiagramViewName) => area.querySelector<HTMLElement>(`.diagram-pane[data-pane="${name}"]`)
  if (view === 'components' && !pane('components')) return
  session.diagramView = view
  if (area.dataset.view !== view) {
    const scroll = pane('sequence')?.querySelector<HTMLElement>('.seq-scroll') ?? null
    const drawing = pane('components')?.querySelector<HTMLElement>('.comp-scroll') ?? null
    const leaving = view === 'components' ? scroll : drawing
    if (leaving) places.set(leaving, { top: leaving.scrollTop, left: leaving.scrollLeft })
    // The side panel shows something of the view being left: a link, or a message.
    closePanelFor(view)
    area.dataset.view = view
    pane('sequence')!.hidden = view !== 'sequence'
    pane('components')!.hidden = view !== 'components'
    area.querySelector('#diagram-title')!.textContent = diagramViewHeading(view)
    area.querySelector('.diagram-hint')!.textContent = diagramViewHint(view)
    area.querySelector('.diagram-area')!.setAttribute('aria-labelledby', `diagram-tab-${view}`)
    for (const tab of area.querySelectorAll<HTMLElement>('[role="tab"]')) {
      const selected = tab.dataset.diagramView === view
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
    }
    if (view === 'sequence' && scroll) restoreSequencePlace(scroll)
    if (view === 'components' && drawing) restoreComponentPlace(drawing)
    if (view === 'components') usage.ping('components-open')
  }
  writeScenarioHash()
  if (announce) say(area, viewAnnouncement(scenario, view))
}

/**
 * A card drawn already showing Components counts as an open, as a tab press does: a report opened
 * at &view=components, a reload, or the next scenario while Components is the chosen view.
 * usage.ping sends each event once per page load.
 */
export function pingShownView(root: ParentNode): void {
  if (root.querySelector('.diagram-panel[data-view="components"]')) usage.ping('components-open')
}

function restoreComponentPlace(drawing: HTMLElement): void {
  const place = places.get(drawing)
  if (!place) return
  drawing.scrollTop = place.top
  drawing.scrollLeft = place.left
}

function restoreSequencePlace(scroll: HTMLElement): void {
  const place = places.get(scroll)
  if (!place) return
  // The page is as tall as the drawing again before it scrolls to the place.
  sizeStage(scroll)
  scroll.scrollTop = place.top
  scrollDiagramToOffset(scroll, place.top)
  scroll.scrollLeft = place.left
  syncDiagramWindow(scroll)
}

function closePanelFor(view: DiagramViewName): void {
  const open = session.inspector?.isOpen() ? session.invoker : null
  if (!open || open.scenarioId !== session.renderedId) return
  const leaving = view === 'components' ? open.messageId !== undefined : open.kind === 'link'
  if (!leaving) return
  // Focus is on the tab (or about to move into the sequence): the panel gives none back.
  session.switchingScenario = true
  session.inspector!.close()
  session.switchingScenario = false
}

/** The same words twice in a row would be no change to a screen reader: empty the line first. */
function say(area: Element, text: string): void {
  const status = area.querySelector('.diagram-view-status')
  if (!status) return
  status.textContent = ''
  requestAnimationFrame(() => {
    status.textContent = text
  })
}

/** ←/→ (and Home/End) move between the tabs; Enter, Space or a click selects. */
export function bindDiagramTabs(root: ParentNode): void {
  const list = root.querySelector<HTMLElement>('.diagram-tabs')
  if (!list) return
  const tabs = () => [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
  list.addEventListener('click', (ev) => {
    const tab = (ev.target as Element).closest<HTMLElement>('[role="tab"]')
    if (!tab || tab.getAttribute('aria-disabled') === 'true') return
    showDiagramView(tab.dataset.diagramView as DiagramViewName)
  })
  list.addEventListener('keydown', (ev) => {
    const all = tabs()
    const at = all.indexOf(ev.target as HTMLElement)
    if (at < 0 || ev.altKey || ev.ctrlKey || ev.metaKey) return
    const next =
      ev.key === 'ArrowRight'
        ? (at + 1) % all.length
        : ev.key === 'ArrowLeft'
          ? (at - 1 + all.length) % all.length
          : ev.key === 'Home'
            ? 0
            : ev.key === 'End'
              ? all.length - 1
              : -1
    if (next < 0) return
    ev.preventDefault()
    ev.stopPropagation()
    for (const tab of all) tab.tabIndex = tab === all[next] ? 0 : -1
    all[next].focus()
  })
}

/** A link in the Components view: its interactions in the side panel. */
export function openLink(scenarioId: string, edgeIndex: number): void {
  const scenario = session.report.scenarios.find((item) => item.id === scenarioId)
  const drawn = mountedComponents(scenarioId)
  if (!session.inspector || !scenario || !drawn) return
  session.panelScenarioId = scenarioId
  session.invoker = { scenarioId, kind: 'link', edge: edgeIndex }
  writeScenarioHash()
  session.inspector.openLink(scenarioId, drawn.graph, edgeIndex, scenario.title)
  syncWithPanel()
}

/**
 * "Show in sequence" in a link's panel: the Sequence view, the message open in the side panel,
 * and its arrow scrolled into view.
 */
export function showInSequence(scenarioId: string, messageId: string): void {
  const scenario = session.report.scenarios.find((item) => item.id === scenarioId)
  const message: MessageEvent | undefined = scenario ? findMessage(scenario, messageId) : undefined
  if (!scenario || !message) return
  showDiagramView('sequence', false)
  const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(scenarioId)} .seq-scroll`)
  if (scroll && diagramState.mounted.has(scenarioId)) focusDiagramMessage(scroll, messageId)
  openMessage(scenario, message)
}

/** Enter (go to the diagram) in the Components view: its first link, or the drawing. */
export function focusComponentView(): boolean {
  if (session.diagramView !== 'components') return false
  const scroller = document.querySelector<HTMLElement>(
    '#main .diagram-pane[data-pane="components"]:not([hidden]) .comp-scroll',
  )
  if (!scroller) return false
  ;(scroller.querySelector<HTMLElement>('.edge-group') ?? scroller).focus()
  return true
}
