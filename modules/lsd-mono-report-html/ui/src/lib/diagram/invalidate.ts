// One repaint per animation frame for a diagram (#104). Feature code (Find, zoom, the participant
// filter, payload search) changes the diagram's state and says which parts that left stale; the
// paint runs once before the next frame, whatever number of changes asked for it, in a fixed
// order: the header frame, the painted window, the Find controls, then the hooks (the side
// panel's Find marks). The header's size is already set when a change asks for 'frame'
// (sizeDiagramFrame or withTrialFrames); the deferred frame redraws it in place and brings the
// zoom readout and the print width up to date, so the order matters less than it reads.
//
// Measuring code stays synchronous: withTrialFrames still draws the frame before it returns, so
// a fit can read the scrollbar and the filter can move focus into the redrawn header. Scrolling,
// resizing, printing and moving focus to a message paint at once as before.
import { cssEscape } from '../escape'
import { syncFindControls } from './search-reveal'
import { diagramState } from './state'
import { applyDiagramFrame, syncDiagramWindow } from './window'

/** What a change left stale, painted in this order. */
export const DIAGRAM_PARTS = ['frame', 'window', 'find', 'hooks'] as const
export type DiagramPart = (typeof DIAGRAM_PARTS)[number]

export type DiagramPainters = Record<DiagramPart, (scrollport: HTMLElement, scenarioId: string) => void> & {
  /** The scenario's mounted scrollport, looked up at paint time (the diagram may have re-rendered). */
  scrollport: (scenarioId: string) => HTMLElement | null
}

export interface Invalidator {
  invalidate: (scenarioId: string, parts: readonly DiagramPart[]) => void
  /** Paint what is pending now, instead of at the next frame. */
  flush: () => void
}

export function createInvalidator(
  paint: DiagramPainters,
  schedule: (run: () => void) => void = (run) => requestAnimationFrame(() => run()),
): Invalidator {
  const pending = new Map<string, Set<DiagramPart>>()
  let queued = false

  /**
   * Paint each pending part. A painter that throws (a hook from the side panel, say) does not keep
   * the other parts or diagrams from painting: the first error is rethrown once all have run.
   */
  function flush(): void {
    queued = false
    const work = [...pending]
    pending.clear()
    let failure: { error: unknown } | null = null
    for (const [scenarioId, parts] of work) {
      const scrollport = paint.scrollport(scenarioId)
      if (!scrollport) continue
      for (const part of DIAGRAM_PARTS) {
        if (!parts.has(part)) continue
        try {
          paint[part](scrollport, scenarioId)
        } catch (error) {
          failure ??= { error }
        }
      }
    }
    if (failure) throw failure.error
  }

  return {
    invalidate(scenarioId, parts) {
      if (!parts.length) return
      const set = pending.get(scenarioId) ?? new Set<DiagramPart>()
      parts.forEach((part) => set.add(part))
      pending.set(scenarioId, set)
      if (queued) return
      queued = true
      schedule(() => {
        if (queued) flush()
      })
    },
    flush,
  }
}

const painters: DiagramPainters = {
  scrollport: (scenarioId) =>
    document.querySelector<HTMLElement>(`.seq-scroll[data-scenario-id="${cssEscape(scenarioId)}"]`),
  frame: (scrollport) => applyDiagramFrame(scrollport),
  window: (scrollport) => syncDiagramWindow(scrollport),
  find: (scrollport) => syncFindControls(scrollport),
  hooks: (_scrollport, scenarioId) => diagramState.findHooks.changed?.(scenarioId),
}

const diagrams = createInvalidator(painters)

/** Mark [parts] of the scenario's diagram stale; they repaint once, before the next frame. */
export function invalidate(scenarioId: string, parts: readonly DiagramPart[]): void {
  diagrams.invalidate(scenarioId, parts)
}

/** Paint every pending diagram change now: for code (and tests) that reads the painted diagram. */
export function flushDiagramPaints(): void {
  diagrams.flush()
}
