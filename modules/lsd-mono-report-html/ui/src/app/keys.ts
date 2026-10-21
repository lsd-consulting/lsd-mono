// The page's key router (#102): what each routed scope sees, and the page and side panel keys.
// The diagram's keys are in diagram-keys.ts and lib/diagram/zoom-keys.ts.
import { focusSelectedDiagram } from './main-view'
import { moveSelection, focusedNavId } from './nav'
import { toggleTheme } from '../ui/theme'
import { paintThemeControl } from '../ui/theme-menu'
import { singleKeysEnabled } from '../ui/shortcuts'
import { scrollBehavior } from '../lib/media'
import { session } from './context'
import { fieldEscapeTargets, keyTarget } from './intents'
import { diagramKeyContext } from '../lib/diagram/diagram-keys'
import { registerZoomKeys } from '../lib/diagram/zoom-keys'
import { createKeyRouter, type KeyContexts, type KeyRouter } from '../lib/keys/router'
import { registerDiagramKeys } from './diagram-keys'

/** What each routed scope sees for the key [e]. */
export function keyContexts(e: KeyboardEvent): KeyContexts {
  const target = e.target as HTMLElement
  const panelOpen = Boolean(session.inspector?.isOpen())
  const singleKeys = singleKeysEnabled()
  return {
    dialog: { open: Boolean(session.help?.isOpen()) },
    panel: { open: panelOpen },
    diagram: diagramKeyContext(target, { singleKeys, panelOpen }),
    page: {
      ...keyTarget(target),
      hasScenario: Boolean(session.renderedId),
      singleKeys,
    },
  }
}

/** Escape closes the keyboard help first, then the side panel. */
export function registerPanelKeys(router: KeyRouter): void {
  router.on('dialog', 'close-help', () => session.help?.close(true))
  router.on('panel', 'close-panel', () => session.inspector?.close())
}

/**
 * Page-wide keys. j/k anywhere outside a text box; arrows only on the list, the page or the
 * scenario heading, so they keep their own meaning in the diagram toolbar and its popovers. On the
 * list, focus follows the selection. Enter on a focused button presses that button (a list item,
 * filters, theme…); anywhere else it goes into the shown diagram.
 */
export function registerPageKeys(router: KeyRouter): void {
  router.on('page', 'clear-field', (e) => clearField(e.target as HTMLInputElement))
  router.on('page', 'leave-field', (e) => leaveField(e.target as HTMLElement))
  router.on('page', 'hold-field', () => {})
  router.on('page', 'search', () => document.querySelector<HTMLInputElement>('#search')?.focus())
  router.on('page', 'next', (e) => moveSelection(1, focusedNavId(e.target as HTMLElement)))
  router.on('page', 'prev', (e) => moveSelection(-1, focusedNavId(e.target as HTMLElement)))
  router.on('page', 'diagram', () => focusSelectedDiagram())
  router.on('page', 'theme', () => paintThemeControl(toggleTheme()))
  router.on('page', 'help', () => session.help?.toggle())
}

/**
 * Escape in a text field with text (#114): empty it the way deleting the text would, so search
 * shows every scenario again and Find drops its matches and count. Focus stays in the field.
 */
export function clearField(field: HTMLInputElement | HTMLTextAreaElement): void {
  field.value = ''
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Escape in an empty text field (#114): focus goes to the field's owner (intents.ts), the first
 * that takes it. The diagram's scrollport is just below Find, so the page mostly stays where it
 * is (scrollportInView); the scenario heading scrolls into view if it is off screen. If none takes
 * focus, the field keeps it.
 */
export function leaveField(field: HTMLElement): void {
  const doc = field.ownerDocument
  for (const to of fieldEscapeTargets(field)) {
    const scrollport = to.classList.contains('seq-scroll')
    to.focus({ preventScroll: scrollport })
    if (doc.activeElement !== to) continue
    if (scrollport) scrollportInView(to)
    return
  }
}

/** Less of the scrollport on screen than this, and it is scrolled into view. */
export const SCROLLPORT_SHOWN_MIN_PX = 100

/**
 * A focused scrollport with less than SCROLLPORT_SHOWN_MIN_PX of it on screen (Find at the foot of
 * the window: at 1280×800 the scrollport's top can be at y=792) comes up to the middle of the
 * window, so where focus went shows (#114). One just above the window comes down the same way.
 */
export function scrollportInView(scrollport: HTMLElement): void {
  const win = scrollport.ownerDocument.defaultView
  if (!win) return
  const box = scrollport.getBoundingClientRect()
  const shown = Math.min(box.bottom, win.innerHeight) - Math.max(box.top, 0)
  if (shown >= Math.min(SCROLLPORT_SHOWN_MIN_PX, box.height)) return
  const by = box.top > 0 ? box.top - win.innerHeight / 2 : box.bottom - win.innerHeight / 2
  win.scrollBy({ top: by, behavior: scrollBehavior() })
}

/** The one keydown listener for the page, the side panel and the diagrams. */
export function listenForKeys(doc: Document): KeyRouter {
  const router = createKeyRouter(keyContexts)
  registerPanelKeys(router)
  registerZoomKeys(router)
  registerDiagramKeys(router)
  registerPageKeys(router)
  const missing = router.unhandled()
  if (missing.length) throw new Error(`key bindings with no handler: ${missing.join(', ')}`)
  router.listen(doc)
  return router
}
