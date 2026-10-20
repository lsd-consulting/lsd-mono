// The zoom keys: Ctrl/Cmd and plain + − 0 and Shift+1, and when they belong to a text field instead.
import { diagramState, diagramView } from './state'
import { singleKeysEnabled } from '../../ui/shortcuts'
import { type ZoomAction, runZoomAction, zoomToMessage } from './zoom-controls'

type ZoomKeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>

/**
 * The zoom action a key asks for, or null. + or =, -, 0 and Shift+1 (by key position, so it works
 * where Shift+1 is not "!") are single-key shortcuts and follow the toggle (#82, WCAG 2.1.4). Esc
 * leaves Overview. Ctrl/Cmd with any of them stays the browser's zoom (WCAG 1.4.4).
 */
export function zoomKeyAction(e: ZoomKeyEvent, ctx: { singleKeys: boolean; overview: boolean }): ZoomAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  if (e.key === 'Escape') return ctx.overview ? 'leave' : null
  if (!ctx.singleKeys) return null
  if (e.key === '+' || e.key === '=') return 'in'
  if (e.key === '-' || e.key === '−') return 'out'
  // Shift is allowed: on AZERTY the digit row needs it for 0.
  if (e.key === '0') return 'reset'
  if (e.shiftKey && e.code === 'Digit1') return 'overview'
  return null
}

function isTextField(el: HTMLElement): boolean {
  return el.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

/**
 * Zoom keys, while focus is in a diagram card (toolbar, participant header, scrollport or a
 * message) and not in a text field or a menu. True when the key was used. In Overview, Enter on
 * a message zooms to it instead of opening it.
 */
export function onZoomKey(ev: KeyboardEvent): boolean {
  const target = ev.target as HTMLElement | null
  if (!target?.closest || isTextField(target) || target.closest('[role="menu"]')) return false
  const scrollport = target.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-scroll')
  const id = scrollport?.dataset.scenarioId
  if (!scrollport || !id || !diagramState.mounted.has(id)) return false
  const view = diagramView(id)
  const message = target.closest<HTMLElement>('button.msg-open')
  const plain = !ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey
  if (view.overview && message?.dataset.messageId && ev.key === 'Enter' && plain) {
    ev.preventDefault()
    ev.stopPropagation()
    zoomToMessage(scrollport, message.dataset.messageId)
    return true
  }
  const action = zoomKeyAction(ev, { singleKeys: singleKeysEnabled(), overview: view.overview != null })
  if (!action) return false
  ev.preventDefault()
  ev.stopPropagation()
  runZoomAction(scrollport, action)
  return true
}
