// The side panel's metrics view (#95, #103): the timing view and the scenario's metrics, opened
// at the top or at one section (Accuracy by pair from its chip).
import { STACKED_MAX_PX, scrollBehavior } from '../lib/media'
import { cssEscape } from '../lib/escape'
import type { Metric } from '../types'
import { TIMING_VIEW_MIN_PX, naturalWidth } from './inspector-width'
import { metricsBodyHtml, metricsMetaHtml, metricsTitle } from './inspector-views'
import type { PanelShell, PanelView } from './inspector-view'

export interface MetricsView {
  /** Scenario title, shown as a pill. */
  heading: string
  metrics: Metric[]
  /** Timing view (summary, swim lanes, waterfall), shown above the metrics. */
  timingHtml?: string
  /** Accuracy by pair, shown last (after the metrics). */
  pairAccuracyHtml?: string
  /** A `data-panel-section` to open at, expanded and scrolled into view, instead of the top. */
  section?: string
  /** The timing chip that opened it (its place in the strip), or null for the toolbar button. */
  chip?: number | null
}

export interface MetricsPanelView extends PanelView {
  open: (scenarioId: string, view: MetricsView) => void
}

export function bindMetricsView(shell: PanelShell, host: HTMLElement): MetricsPanelView {
  const { panel } = shell

  /**
   * Open [section] (a folded list unfolds) and scroll it to just under the panel's sticky header:
   * inside the panel where it scrolls (the side column), or the page where the panel is part of
   * it (stacked, under 860px). Focus stays where opening put it; the header with Close stays in view.
   */
  function revealSection(section: HTMLElement): void {
    section.querySelectorAll('details').forEach((d) => (d.open = true))
    const head = panel.querySelector<HTMLElement>('.inspector-head')?.getBoundingClientRect().height ?? 0
    const top = section.getBoundingClientRect().top
    const gap = 8
    if (shell.viewport() > STACKED_MAX_PX) {
      const delta = top - panel.getBoundingClientRect().top - head - gap
      panel.scrollTo({ top: panel.scrollTop + delta, behavior: scrollBehavior() })
      return
    }
    const win = shell.doc.defaultView
    if (!win) return
    const bar = Number.parseFloat(win.getComputedStyle(shell.doc.documentElement).getPropertyValue('--topbar-h'))
    const offset = (Number.isFinite(bar) ? bar : 0) + head + gap
    win.scrollTo({ top: Math.max(0, win.scrollY + top - offset), behavior: scrollBehavior() })
  }

  const view: MetricsPanelView = {
    open(scenarioId, metrics) {
      shell.begin(view, { scenarioId, kind: 'metrics', chip: metrics.chip ?? null })
      shell.json.stop()
      shell.title.textContent = metricsTitle(metrics)
      shell.meta.innerHTML = metricsMetaHtml(metrics)
      shell.showViewChrome(host)
      host.innerHTML = metricsBodyHtml(scenarioId, metrics)
      shell.width.fit(Math.max(naturalWidth(host), metrics.timingHtml ? TIMING_VIEW_MIN_PX : 0))
      const section = metrics.section
        ? host.querySelector<HTMLElement>(`[data-panel-section="${cssEscape(metrics.section)}"]`)
        : null
      if (section) revealSection(section)
      else {
        // At the top, even when the panel was already open and scrolled (say to Accuracy by pair
        // from the Accuracy chip). Stacked, the panel is part of the page and does not scroll.
        if (shell.viewport() > STACKED_MAX_PX) panel.scrollTop = 0
        shell.revealOnPhone()
      }
    },
    close() {},
    // Back to the Metrics button, or the timing chip that opened it (#86).
    focusReturn(invoker) {
      if (!invoker) return { kind: 'none' }
      return {
        kind: 'button',
        scenarioId: invoker.scenarioId,
        selector: '.diagram-pane:not([hidden]) .seq-toolbar [data-show-metrics]',
        chip: invoker.chip ?? null,
      }
    },
  }
  return view
}
