// The Components view (#105): the scenario's component diagram in the diagram area, the other
// view behind the Sequence | Components tabs. Its scrollport scrolls both ways inside the card,
// with a cue on each edge that has more of the drawing past it, and its links open the side panel.
import type { Scenario } from '../types'
import { type ComponentGraph, componentGraph } from './component-graph'
import { renderComponentDiagram } from './component-diagram'
import { escapeAttr, escapeHtml } from './escape'
import { tooSmallDescription } from './diagram-view'
import { isCoarsePointer } from './media'

/** A drawn component diagram: its graph, for the links, its natural size and its columns. */
export interface MountedComponents {
  graph: ComponentGraph
  /** The scenario's title, which the drawing's name starts with. */
  title: string
  width: number
  height: number
  /** The columns a tall graph wrapped into for the room it was laid out in (#115, #121). */
  columns: number
}

const mounted = new Map<string, MountedComponents>()
/**
 * The room (scrollport width, CSS px) each scenario's drawing was last laid out for, so a redraw
 * of the card starts from the layout it had; before the view is first measured, unlimited.
 */
const laidOutFor = new Map<string, number>()

export function mountedComponents(scenarioId: string): MountedComponents | undefined {
  return mounted.get(scenarioId)
}

/**
 * The view: its toolbar ([toolbarHtml]: the zoom group and Metrics) and the drawing in its
 * scrollport, at [zoom]. The drawing's size at the current scale is --comp-w and --comp-h.
 */
export function componentViewHtml(scenario: Scenario, toolbarHtml: string, zoom = 1): string {
  const graph = componentGraph(scenario)
  const drawn = renderComponentDiagram(graph, scenario.title, laidOutFor.get(scenario.id))
  mounted.set(scenario.id, {
    graph,
    title: scenario.title,
    width: drawn.width,
    height: drawn.height,
    columns: drawn.columns,
  })
  const svg = scrollportSvg(drawn.svg)
  return `
    <div class="comp-diagram">
      <div class="seq-toolbar comp-toolbar" role="toolbar" aria-label="Diagram view">${toolbarHtml}</div>
      <div class="comp-scroll" data-scenario-id="${escapeAttr(scenario.id)}" style="--comp-w:${drawn.width * zoom}px;--comp-h:${drawn.height * zoom}px;--comp-natural-w:${drawn.width}px">${svg}</div>
      <span class="comp-too-small" id="${escapeAttr(tooSmallDescriptionId(scenario.id))}" hidden>${escapeHtml(tooSmallDescription(isCoarsePointer()))}</span>
    </div>`
}

/** Its size comes from the scrollport's --comp-w and --comp-h, not the drawing's own style. */
function scrollportSvg(svg: string): string {
  return svg.replace(/(<svg class="component-diagram"[^>]*?) style="[^"]*"/, '$1')
}

/**
 * Lay [scroller]'s drawing out again for [room] (the scrollport's width, CSS px) when that crosses
 * ONE_COLUMN_BELOW_PX and so changes how many columns a tall graph wraps into (#121): one below
 * it (a phone), the squarer layout of #115 from it up. The links keep their indexes, so the
 * selected link stays selected and a focused one keeps focus. True when it redrew; the caller
 * then fits the new size.
 */
export function relayoutComponents(scroller: HTMLElement, room: number): boolean {
  const id = scroller.dataset.scenarioId ?? ''
  const drawn = mounted.get(id)
  const old = scroller.querySelector('svg.component-diagram')
  if (!drawn || !old || room <= 0) return false
  const fresh = renderComponentDiagram(drawn.graph, drawn.title, room)
  laidOutFor.set(id, room)
  if (fresh.columns === drawn.columns) return false
  const selected = [...old.querySelectorAll('.edge-group.is-selected')].map((el) => el.getAttribute('data-edge-index'))
  const focused = old.contains(document.activeElement)
    ? document.activeElement?.closest('.edge-group')?.getAttribute('data-edge-index')
    : undefined
  const describedBy = old.getAttribute('aria-describedby')
  old.outerHTML = scrollportSvg(fresh.svg)
  mounted.set(id, { ...drawn, width: fresh.width, height: fresh.height, columns: fresh.columns })
  const svg = scroller.querySelector('svg.component-diagram')!
  if (describedBy) svg.setAttribute('aria-describedby', describedBy)
  const links = [...svg.querySelectorAll<SVGElement>('.edge-group')]
  const link = (index: string | null | undefined) =>
    index == null ? undefined : links.find((el) => el.getAttribute('data-edge-index') === index)
  for (const index of selected) link(index)?.classList.add('is-selected')
  link(focused)?.focus({ preventScroll: true })
  scroller.style.setProperty('--comp-natural-w', `${fresh.width}px`)
  return true
}

/** The id of the text that describes [scenarioId]'s drawing while it is too small to read (#120). */
export function tooSmallDescriptionId(scenarioId: string): string {
  return `comp-too-small-${scenarioId}`
}

/** Which edges of [scroller] have more of the drawing past them, within a pixel. */
export function moreEdges(scroller: {
  scrollLeft: number
  scrollTop: number
  scrollWidth: number
  scrollHeight: number
  clientWidth: number
  clientHeight: number
}): { left: boolean; right: boolean; up: boolean; down: boolean } {
  const across = scroller.scrollWidth - scroller.clientWidth
  const down = scroller.scrollHeight - scroller.clientHeight
  return {
    left: across > 1 && scroller.scrollLeft > 1,
    right: across > 1 && scroller.scrollLeft < across - 1,
    up: down > 1 && scroller.scrollTop > 1,
    down: down > 1 && scroller.scrollTop < down - 1,
  }
}

/**
 * Mark the edges with more (data-more-left, -right, -up, -down) for the cues, and make the
 * scroller a named region with a tab stop only while it overflows: a drawing that fits would be
 * an empty stop before its links.
 */
export function markComponentScroll(scroller: HTMLElement): void {
  const more = moreEdges(scroller)
  scroller.toggleAttribute('data-more-left', more.left)
  scroller.toggleAttribute('data-more-right', more.right)
  scroller.toggleAttribute('data-more-up', more.up)
  scroller.toggleAttribute('data-more-down', more.down)
  if (more.left || more.right || more.up || more.down) {
    scroller.tabIndex = 0
    scroller.setAttribute('role', 'region')
    scroller.setAttribute('aria-label', 'Component diagram drawing')
  } else if (scroller.ownerDocument.activeElement === scroller) {
    // It fits now (Overview, a wider window), but it has focus: taking its tab stop would drop
    // focus to the page, and the zoom keys with it. It stays a stop until focus leaves.
    if (!scroller.hasAttribute('data-keep-stop')) {
      scroller.setAttribute('data-keep-stop', '')
      scroller.addEventListener(
        'blur',
        () => {
          scroller.removeAttribute('data-keep-stop')
          markComponentScroll(scroller)
        },
        { once: true },
      )
    }
  } else {
    scroller.removeAttribute('tabindex')
    scroller.removeAttribute('role')
    scroller.removeAttribute('aria-label')
  }
}

/** Scroll an overflowing drawing so the middle of its top row (the root, for one) is centred. */
export function centreTopRow(scroller: HTMLElement): void {
  if (scroller.scrollWidth <= scroller.clientWidth + 1) return
  const boxes = [...scroller.querySelectorAll('.component-node')].map((node) => node.getBoundingClientRect())
  if (!boxes.length) return
  const top = Math.min(...boxes.map((box) => box.top))
  const row = boxes.filter((box) => box.top < top + 1)
  const middle = (Math.min(...row.map((box) => box.left)) + Math.max(...row.map((box) => box.right))) / 2
  scroller.scrollLeft += middle - scroller.getBoundingClientRect().left - scroller.clientWidth / 2
}

/** One observer for every Components scrollport, and what each runs when its size changes. */
const resize: { observer: ResizeObserver | null; runs: Map<Element, (() => void)[]> } = {
  observer: null,
  runs: new Map(),
}

/**
 * Run [run] whenever [scroller]'s size changes. All the Components views share one observer,
 * which lets go of scrollports a redraw has taken out of the page, as the sequence side does.
 */
export function onComponentResize(scroller: HTMLElement, run: () => void): void {
  if (typeof ResizeObserver === 'undefined') return
  resize.observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) for (const each of resize.runs.get(entry.target) ?? []) each()
  })
  for (const old of resize.runs.keys()) {
    if (!old.isConnected) {
      resize.observer.unobserve(old)
      resize.runs.delete(old)
    }
  }
  const runs = resize.runs.get(scroller)
  if (runs) runs.push(run)
  else {
    resize.runs.set(scroller, [run])
    resize.observer.observe(scroller)
  }
}

/** The scrollports the shared observer is watching (for tests). */
export function observedComponentScrolls(): Element[] {
  return [...resize.runs.keys()]
}

/** What the view does with a link that is clicked, or pressed with Enter or Space. */
export type OpenLink = (scenarioId: string, edgeIndex: number, link: Element) => void

/**
 * Bind the Components views under [root]: the edge cues (they follow a scroll, a resize and
 * the view being shown), the top row centred the first time the view has a width, a link that
 * takes focus scrolled into view, and [openLink] for a link.
 */
export function bindComponentViews(root: ParentNode, openLink: OpenLink): void {
  root.querySelectorAll<HTMLElement>('.comp-scroll').forEach((scroller) => {
    const id = scroller.dataset.scenarioId
    if (!id) return
    let centred = false
    const update = (): void => {
      if (!centred && scroller.clientWidth > 0) {
        centred = true
        centreTopRow(scroller)
      }
      markComponentScroll(scroller)
    }
    scroller.addEventListener('scroll', update, { passive: true })
    onComponentResize(scroller, update)
    scroller.addEventListener('focusin', (ev) => {
      const target = ev.target as Element
      if (target !== scroller) target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    })
    const activate = (ev: Event): void => {
      const link = (ev.target as Element | null)?.closest?.('.edge-group')
      if (!link) return
      if (ev.type === 'keydown') {
        const key = (ev as KeyboardEvent).key
        if (key !== 'Enter' && key !== ' ') return
        ev.preventDefault()
      }
      scroller.querySelectorAll('.edge-group.is-selected').forEach((el) => el.classList.remove('is-selected'))
      link.classList.add('is-selected')
      openLink(id, Number(link.getAttribute('data-edge-index')), link)
    }
    scroller.addEventListener('click', activate)
    scroller.addEventListener('keydown', activate)
    update()
  })
}
