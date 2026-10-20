// The Components view (#105): the scenario's component diagram in the diagram area, the other
// view behind the Sequence | Components tabs. Its scrollport scrolls both ways inside the card,
// with a cue on each edge that has more of the drawing past it, and its links open the side panel.
import type { Scenario } from '../types'
import { type ComponentGraph, componentGraph } from './component-graph'
import { renderComponentDiagram } from './component-diagram'
import { escapeAttr } from './escape'

/** A drawn component diagram: its graph, for the links, and its natural size. */
export interface MountedComponents {
  graph: ComponentGraph
  width: number
  height: number
}

const mounted = new Map<string, MountedComponents>()

export function mountedComponents(scenarioId: string): MountedComponents | undefined {
  return mounted.get(scenarioId)
}

/**
 * The view: its toolbar ([toolbarHtml]: the zoom group and Metrics) and the drawing in its
 * scrollport. The drawing's size at the current scale is --comp-w and --comp-h.
 */
export function componentViewHtml(scenario: Scenario, toolbarHtml: string): string {
  const graph = componentGraph(scenario)
  const drawn = renderComponentDiagram(graph, scenario.title)
  mounted.set(scenario.id, { graph, width: drawn.width, height: drawn.height })
  // Its size comes from the scrollport's --comp-w and --comp-h, not the drawing's own style.
  const svg = drawn.svg.replace(/(<svg class="component-diagram"[^>]*?) style="[^"]*"/, '$1')
  return `
    <div class="comp-diagram">
      <div class="seq-toolbar comp-toolbar" role="toolbar" aria-label="Diagram view">${toolbarHtml}</div>
      <div class="comp-scroll" data-scenario-id="${escapeAttr(scenario.id)}" style="--comp-w:${drawn.width}px;--comp-h:${drawn.height}px;--comp-natural-w:${drawn.width}px">${svg}</div>
    </div>`
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
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(scroller)
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
