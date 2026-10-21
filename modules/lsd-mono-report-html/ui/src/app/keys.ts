// The page's key router (#102): what each routed scope sees, and the page and side panel keys.
// The diagram's keys are in diagram-keys.ts and lib/diagram/zoom-keys.ts.
import { focusSelectedDiagram } from './main-view'
import { moveSelection, focusedNavId } from './nav'
import { toggleTheme } from '../ui/theme'
import { paintThemeControl } from '../ui/theme-menu'
import { singleKeysEnabled } from '../ui/shortcuts'
import { session } from './context'
import { keyTarget } from './intents'
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
  router.on('page', 'blur', (e) => (e.target as HTMLInputElement).blur())
  router.on('page', 'search', () => document.querySelector<HTMLInputElement>('#search')?.focus())
  router.on('page', 'next', (e) => moveSelection(1, focusedNavId(e.target as HTMLElement)))
  router.on('page', 'prev', (e) => moveSelection(-1, focusedNavId(e.target as HTMLElement)))
  router.on('page', 'diagram', () => focusSelectedDiagram())
  router.on('page', 'theme', () => paintThemeControl(toggleTheme()))
  router.on('page', 'help', () => session.help?.toggle())
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
