// The side panel's link view (#105): one link of the Components view, titled "from → to", with
// its interactions, each with a "Show in sequence" button. Esc or Close gives focus back to the link.
import type { ComponentGraph } from '../lib/component-graph'
import { componentLinkHtml, componentLinkMetaHtml, componentLinkTitle } from './inspector-views'
import type { PanelShell, PanelView } from './inspector-view'

export interface LinkView extends PanelView {
  open: (scenarioId: string, graph: ComponentGraph, edgeIndex: number, heading: string) => void
}

export function bindLinkView(shell: PanelShell, host: HTMLElement): LinkView {
  const view: LinkView = {
    open(scenarioId, graph, edgeIndex, heading) {
      const edge = graph.edges[edgeIndex]
      if (!edge) return
      shell.begin(view, { scenarioId, kind: 'link', edge: edgeIndex })
      shell.json.stop()
      shell.title.textContent = componentLinkTitle(graph, edge)
      shell.meta.innerHTML = componentLinkMetaHtml(edge, heading)
      shell.showViewChrome(host)
      host.innerHTML = componentLinkHtml(scenarioId, edge)
      shell.revealOnPhone()
    },
    close() {},
    // Back to the link in the drawing.
    focusReturn(invoker) {
      if (!invoker || invoker.edge == null) return { kind: 'none' }
      return {
        kind: 'button',
        scenarioId: invoker.scenarioId,
        selector: `.comp-scroll .edge-group[data-edge-index="${invoker.edge}"]`,
        chip: null,
      }
    },
  }
  return view
}
