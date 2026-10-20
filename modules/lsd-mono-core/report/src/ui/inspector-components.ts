// The side panel's component diagram view (#66, #103): the drawing, the interactions of the link
// picked in it, and the drawing's sideways scroll on a phone-width panel.
import { renderComponentDiagram } from '../lib/component-diagram'
import type { ComponentGraph } from '../lib/component-graph'
import { componentLinkHtml, componentsBodyHtml, componentsMetaHtml } from './inspector-views'
import type { PanelShell, PanelView } from './inspector-view'

export interface ComponentsView extends PanelView {
  open: (scenarioId: string, graph: ComponentGraph, heading: string) => void
}

export function bindComponentsView(shell: PanelShell, host: HTMLElement): ComponentsView {
  /** Graph behind the drawn component diagram, so a clicked link can list its messages. */
  let shownGraph: ComponentGraph | null = null
  const scroll = componentScroll()

  /** List one link's interactions under the drawing and mark the link as selected. */
  function showLink(group: Element): void {
    const graph = shownGraph
    const list = host.querySelector<HTMLElement>('.component-links')
    const edge = graph?.edges[Number(group.getAttribute('data-edge-index'))]
    if (!graph || !list || !edge) return
    host.querySelectorAll('.edge-group.is-selected').forEach((el) => el.classList.remove('is-selected'))
    group.classList.add('is-selected')
    list.innerHTML = componentLinkHtml(graph, edge)
  }

  host.addEventListener('click', (event) => {
    const group = (event.target as Element | null)?.closest?.('.edge-group')
    if (group) showLink(group)
  })
  host.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const group = (event.target as Element | null)?.closest?.('.edge-group')
    if (!group) return
    event.preventDefault()
    showLink(group)
  })

  const view: ComponentsView = {
    open(scenarioId, graph, heading) {
      shell.begin(view, { scenarioId, kind: 'components' })
      shell.json.stop()
      shell.title.textContent = 'Component diagram'
      shell.meta.innerHTML = componentsMetaHtml(graph, heading)
      shell.showViewChrome(host)
      const drawn = renderComponentDiagram(graph, heading)
      shownGraph = graph
      host.innerHTML = componentsBodyHtml(drawn.svg, graph)
      shell.width.fit(drawn.width)
      shell.revealOnPhone()
      scroll.bind(host.querySelector<HTMLElement>('.component-scroll'))
    },
    close: () => scroll.bind(null),
    // Back to the Component diagram button.
    focusReturn(invoker) {
      if (!invoker) return { kind: 'none' }
      return {
        kind: 'button',
        scenarioId: invoker.scenarioId,
        selector: '.seq-toolbar [data-show-components]',
        chip: null,
      }
    },
  }
  return view
}

export interface ComponentScroll {
  /** Watch [scroller], the drawing just shown; null stops watching. */
  bind: (scroller: HTMLElement | null) => void
}

/**
 * The component drawing's sideways scroll (#66). Only a phone-width panel lets it overflow. It
 * opens with its top row centred, so the root is on screen, and marks the scroller with
 * `data-more-right` and `data-more-left` while part of it lies past that edge, for the cues in
 * narrow.css. The marks follow a scroll, a resize or a rotate. A link that takes focus is
 * scrolled into view. One drawing is watched at a time.
 */
export function componentScroll(): ComponentScroll {
  /** Watches the drawing's box for a rotate or a resize. */
  let resize: ResizeObserver | null = null
  const bound = new WeakSet<HTMLElement>()
  const marks = new WeakMap<HTMLElement, () => void>()

  return {
    bind(scroller) {
      resize?.disconnect()
      resize = null
      if (!scroller) return
      const update = (): void => {
        const more = scroller.scrollWidth - scroller.clientWidth
        scroller.toggleAttribute('data-more-right', scroller.scrollLeft < more - 1)
        scroller.toggleAttribute('data-more-left', more > 1 && scroller.scrollLeft > 1)
        // A tab stop (and a named region) only while there is something to scroll to: a drawing
        // that fits, as on a desktop panel, would be an empty stop before its links.
        if (more > 1) {
          scroller.tabIndex = 0
          scroller.setAttribute('role', 'region')
          scroller.setAttribute('aria-label', 'Component diagram drawing')
        } else {
          scroller.removeAttribute('tabindex')
          scroller.removeAttribute('role')
          scroller.removeAttribute('aria-label')
        }
      }
      // Each render makes a new scroller, so listeners go on once per element; a second bind of
      // the same element (a re-bind without a re-render) only re-marks it.
      if (!bound.has(scroller)) {
        bound.add(scroller)
        scroller.addEventListener('scroll', () => marks.get(scroller)?.(), { passive: true })
        scroller.addEventListener('focusin', (ev) => {
          const target = ev.target as Element
          if (target !== scroller) target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
        })
      }
      marks.set(scroller, update)
      if (typeof ResizeObserver !== 'undefined') {
        resize = new ResizeObserver(update)
        resize.observe(scroller)
      }
      centreTopRow(scroller)
      update()
    },
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
