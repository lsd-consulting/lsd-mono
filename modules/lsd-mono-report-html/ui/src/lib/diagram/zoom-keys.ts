// The zoom keys' handlers for the key router. Which key is which is in keys/zoom-key-map.ts.
import type { DiagramKeyContext } from '../keys/bindings'
import type { KeyRouter } from '../keys/router'
import { type ZoomAction, runZoomAction, zoomToMessage } from './zoom-controls'
import { isComponentScroll, runComponentZoom } from '../component-zoom'

/** The zoom keys' handlers. Which key is which, and where they apply, is in KEY_BINDINGS. */
export function registerZoomKeys(router: KeyRouter): void {
  const zoom = (action: ZoomAction) => (_e: KeyboardEvent, c: DiagramKeyContext) => {
    if (!c.scrollport) return
    // The Components view (#105) has the same keys.
    if (isComponentScroll(c.scrollport)) runComponentZoom(c.scrollport, action)
    else runZoomAction(c.scrollport, action)
  }
  router.on('diagram', 'zoom-in', zoom('in'))
  router.on('diagram', 'zoom-out', zoom('out'))
  router.on('diagram', 'zoom-reset', zoom('reset'))
  router.on('diagram', 'overview', zoom('overview'))
  router.on('diagram', 'leave-overview', zoom('leave'))
  router.on('diagram', 'actual-size', zoom('actual'))
  router.on('diagram', 'zoom-to-message', (_e, c) => {
    if (c.scrollport && c.messageId) zoomToMessage(c.scrollport, c.messageId)
  })
}
