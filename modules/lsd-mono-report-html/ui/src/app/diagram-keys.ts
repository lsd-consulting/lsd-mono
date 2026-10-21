// A diagram's keys for the key router (#102): stepping Find, scrolling sideways, moving between
// messages and opening one. The zoom keys are in lib/diagram/zoom-keys.ts.
import { isCoarsePointer } from '../lib/media'
import { diagramKeyAction, messagePlaces, sidewaysScrollLeft } from '../lib/diagram-a11y'
import { findStepKey } from '../lib/diagram/search-reveal'
import { diagramView, findMessage, focusDiagramMessage, stepFind } from '../lib/sequence-diagram'
import type { DiagramKeyContext } from '../lib/keys/bindings'
import type { KeyRouter } from '../lib/keys/router'
import { session } from './context'
import { openMessage, scenarioFrom } from './panel'

export function registerDiagramKeys(router: KeyRouter): void {
  router.on('diagram', 'find-step', onFindStep)
  router.on('diagram', 'scroll-sideways', (e, c) => {
    const left = c.scrollport ? sidewaysScrollLeft(e, c.scrollport) : null
    if (left == null) return false
    c.scrollport!.scrollLeft = left
  })
  router.on('diagram', 'move', onMessageKey)
  router.on('diagram', 'open', onMessageKey)
  router.on('diagram', 'open-link', (_e, c) => openFromDiagram(c.target, c.messageId))
}

/** A step key in a diagram's find box: go to the next or previous match, wrapping, and bring it on screen. */
function onFindStep(e: KeyboardEvent, c: DiagramKeyContext): boolean | void {
  const step = findStepKey(e)
  if (!c.scrollport || !step) return false
  // A soft keyboard's Go / Search key sends Enter: close the keyboard so the match has the screen.
  if (e.key === 'Enter' && isCoarsePointer()) (c.target as HTMLInputElement).blur()
  stepFind(c.scrollport, step)
}

/** Up and Down move along the arrows (the panel, if open, follows); Enter or Space opens one. */
function onMessageKey(e: KeyboardEvent, c: DiagramKeyContext): boolean | void {
  const scenario = c.scrollport ? scenarioFrom(c.scrollport) : null
  if (!scenario || !c.scrollport) return false
  const view = diagramView(scenario.id)
  const action = diagramKeyAction({
    key: e.key,
    places: messagePlaces(scenario.events, view.hidden),
    activeId: (c.on === 'arrow' ? c.messageId : null) ?? view.activeMessageId,
    inDiagram: true,
  })
  if (action.type === 'noop' || !action.messageId) return false
  const msg = findMessage(scenario, action.messageId)
  if (action.type === 'move') {
    focusDiagramMessage(c.scrollport, action.messageId)
    if (session.inspector?.isOpen() && msg) openMessage(scenario, msg)
  } else if (msg) openMessage(scenario, msg)
}

/** Opens the message [messageId] of the scenario card holding [node]. */
export function openFromDiagram(node: Element, messageId: string | null): void {
  const scenario = scenarioFrom(node)
  if (!scenario || !messageId) return
  const msg = findMessage(scenario, messageId)
  if (msg) openMessage(scenario, msg)
}
