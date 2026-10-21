// The zoom keys: plain + − 0, Shift+1 (Overview, the fit) and Shift+0 (1:1, #120), and Esc to leave Overview. Pure, so the key table
// (bindings.ts) and the help drawn from it do not load the diagram's zoom code.
import type { ZoomAction } from '../diagram/zoom-controls'

export type ZoomKeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'> & {
  repeat?: boolean
}

/**
 * The zoom action a key asks for, or null. + or =, -, 0 and Shift+1 (by key position, so it works
 * where Shift+1 is not "!") are single-key shortcuts and follow the toggle (#82, WCAG 2.1.4). Esc
 * leaves Overview, unless the side panel is open: Esc closes that first, and only that (#102).
 * Ctrl/Cmd with any of them stays the browser's zoom (WCAG 1.4.4).
 */
export function zoomKeyAction(
  e: ZoomKeyEvent,
  ctx: { singleKeys: boolean; overview: boolean; panelOpen?: boolean },
): ZoomAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  // Held down, Escape leaves Overview only on its first press.
  if (e.key === 'Escape') return ctx.overview && !ctx.panelOpen && !e.repeat ? 'leave' : null
  if (!ctx.singleKeys) return null
  if (e.key === '+' || e.key === '=') return 'in'
  if (e.key === '-' || e.key === '−') return 'out'
  // Shift is allowed: on AZERTY the digit row needs it for 0.
  if (e.key === '0') return 'reset'
  if (e.shiftKey && e.code === 'Digit1') return 'overview'
  // Shift+0 by key position (")" on US/UK keyboards): actual size (#120). Where the shifted key
  // is "0" itself (AZERTY), it stays the reset above; the 1:1 button is there for those layouts.
  if (e.shiftKey && e.code === 'Digit0') return 'actual'
  return null
}
