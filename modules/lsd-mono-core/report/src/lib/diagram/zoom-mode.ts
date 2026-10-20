// The diagram's zoom mode (#100) and how each zoom change moves it on. One field replaces the
// autoFit, overview and fittedWidth flags #94 left; the fit width only means something in the
// default view and Overview, so it lives there.
import type { SavedView, ZoomMode } from './state'

/** What moved the zoom. */
export type ZoomEvent =
  /** − or +, the wheel: the user's own zoom. Leaves Overview without going back. */
  | { kind: 'step' }
  /** The % readout, or Enter or a click in Overview: the default view, fitted afresh. */
  | { kind: 'reset' }
  /** Overview on, remembering where the view was. */
  | { kind: 'enter-overview'; at: Omit<SavedView, 'mode'> }
  /** Overview off: back to the mode it was turned on from. */
  | { kind: 'leave-overview' }
  /** A fit to [width] happened. Only the default view and Overview keep it. */
  | { kind: 'fitted'; width: number }
  /** Forget the default view's fit, so the next one runs (a re-render). */
  | { kind: 'refit' }
  /**
   * Lanes hidden or shown: the default view's fit no longer stands, and neither does the one
   * Overview goes back to, so leaving Overview fits the lanes left.
   */
  | { kind: 'lanes-changed' }

/** The mode a diagram opens in, and goes back to on reset: the default view, not fitted yet. */
export function defaultMode(): ZoomMode {
  return { kind: 'default', fittedWidth: 0 }
}

export function zoomModeAfter(mode: ZoomMode, event: ZoomEvent): ZoomMode {
  switch (event.kind) {
    case 'step':
      return { kind: 'zoomed' }
    case 'reset':
      return defaultMode()
    case 'enter-overview':
      if (mode.kind === 'overview') return mode
      return { kind: 'overview', fittedWidth: 0, saved: { ...event.at, mode } }
    case 'leave-overview':
      return mode.kind === 'overview' ? mode.saved.mode : mode
    case 'fitted':
      return mode.kind === 'zoomed' ? mode : { ...mode, fittedWidth: event.width }
    case 'refit':
      return mode.kind === 'default' ? defaultMode() : mode
    case 'lanes-changed':
      if (mode.kind === 'overview' && mode.saved.mode.kind === 'default') {
        return { ...mode, saved: { ...mode.saved, mode: { kind: 'default', fittedWidth: 0 } } }
      }
      return zoomModeAfter(mode, { kind: 'refit' })
  }
}

/** The width the last fit used, or null when the user's zoom is kept as it is. */
export function fittedWidthOf(mode: ZoomMode): number | null {
  return mode.kind === 'zoomed' ? null : mode.fittedWidth
}
