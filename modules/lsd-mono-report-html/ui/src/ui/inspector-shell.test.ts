// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { componentGraph } from '../lib/component-graph'
import { sampleReport } from '../data/sample-report'
import { bindInspector, inspectorMarkup } from './inspector'
import { bindLinkView } from './inspector-link'
import { bindErrorView, bindMessageView } from './inspector-message'
import { bindMetricsView } from './inspector-metrics'
import { bindPanelShell } from './inspector-shell'
import type { FocusReturn, PanelShell, PanelView } from './inspector-view'

/** A shell that only records what the views ask of it. */
function fakeShell(): PanelShell {
  const el = () => document.createElement('div')
  return {
    doc: document,
    panel: el(),
    title: el(),
    meta: el(),
    lead: el(),
    json: {} as PanelShell['json'],
    width: {} as PanelShell['width'],
    begin: () => 1,
    showViewChrome: () => {},
    revealOnPhone: () => {},
    viewport: () => 1200,
  }
}

describe('focusReturn', () => {
  const shell = fakeShell()

  it("goes back to the link, the shown view's Metrics button, or the timing chip that opened Metrics", () => {
    const host = document.createElement('div')
    expect(bindLinkView(shell, host).focusReturn({ scenarioId: 'a', kind: 'link', edge: 3 })).toEqual({
      kind: 'button',
      scenarioId: 'a',
      selector: '.comp-scroll .edge-group[data-edge-index="3"]',
      chip: null,
    })
    const metrics = bindMetricsView(shell, host)
    expect(metrics.focusReturn({ scenarioId: 'a', kind: 'metrics' })).toEqual({
      kind: 'button',
      scenarioId: 'a',
      selector: '.diagram-pane:not([hidden]) .seq-toolbar [data-show-metrics]',
      chip: null,
    })
    expect(metrics.focusReturn({ scenarioId: 'a', kind: 'metrics', chip: 2 })).toMatchObject({ chip: 2 })
    expect(metrics.focusReturn(null)).toEqual({ kind: 'none' })
    expect(bindLinkView(shell, host).focusReturn(null)).toEqual({ kind: 'none' })
  })

  it('goes back to the message that was open, or nowhere', () => {
    const message = bindMessageView(shell, () => Promise.resolve(null))
    expect(message.focusReturn({ scenarioId: 'a', messageId: 'm1', kind: 'message' })).toEqual({
      kind: 'message',
      scenarioId: 'a',
      messageId: 'm1',
    })
    expect(message.focusReturn({ scenarioId: 'a' })).toEqual({ kind: 'none' })
    expect(message.focusReturn(null)).toEqual({ kind: 'none' })
    expect(bindErrorView(shell).focusReturn(null)).toEqual({ kind: 'none' })
  })
})

describe('the shell and its views', () => {
  const graph = componentGraph(sampleReport.scenarios[0])

  it('hands the closing view its focus return, and the metrics chip rides on the invoker', () => {
    document.body.innerHTML = `<div class="shell">${inspectorMarkup()}</div>`
    const closed: unknown[] = []
    const inspector = bindInspector(document, {
      loadPayload: () => Promise.resolve(null),
      onClose: (invoker, focus) => closed.push({ invoker, focus }),
    })
    inspector.openMetrics('s1', { heading: 'S', metrics: [], chip: 1 })
    inspector.close()
    expect(closed).toEqual([
      {
        invoker: { scenarioId: 's1', kind: 'metrics', chip: 1 },
        focus: {
          kind: 'button',
          scenarioId: 's1',
          selector: '.diagram-pane:not([hidden]) .seq-toolbar [data-show-metrics]',
          chip: 1,
        },
      },
    ])
    inspector.openLink('s1', graph, 0, 'S')
    inspector.openError({ status: 'error', headline: 'Boom', message: 'm' })
    inspector.close()
    expect(closed[1]).toEqual({ invoker: null, focus: { kind: 'none' } })
  })
})

describe('the shell closes the view it shows (#103)', () => {
  const mountShell = () => {
    document.body.innerHTML = `<div class="shell">${inspectorMarkup()}</div>`
    const closed: FocusReturn[] = []
    const panel = bindPanelShell(document, { onClose: (_invoker, focus) => closed.push(focus) })
    return { panel, closed }
  }
  const countingView = (name: string) => {
    const view = {
      closes: 0,
      close() {
        view.closes++
      },
      focusReturn: (): FocusReturn => ({ kind: 'button', scenarioId: name, selector: `#${name}`, chip: null }),
    }
    return view satisfies PanelView
  }

  it('closes the previous view when another opens, and the showing one when the panel closes', () => {
    const { panel, closed } = mountShell()
    const a = countingView('a')
    const b = countingView('b')
    panel.shell.begin(a, { scenarioId: 's', kind: 'link' })
    panel.shell.begin(a, { scenarioId: 's', kind: 'link' })
    expect(a.closes).toBe(0)
    panel.shell.begin(b, { scenarioId: 's', kind: 'metrics' })
    expect(a.closes).toBe(1)
    expect(b.closes).toBe(0)
    panel.close()
    expect(b.closes).toBe(1)
    expect(a.closes).toBe(1)
    expect(closed).toEqual([{ kind: 'button', scenarioId: 'b', selector: '#b', chip: null }])
    // Closed already: nothing more to close.
    panel.close()
    expect(b.closes).toBe(1)
  })
})
