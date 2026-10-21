// Where in a diagram card a key was pressed (#102), read from the DOM for the key router.
import type { DiagramKeyContext } from '../keys/bindings'
import { diagramState, diagramView } from './state'
import { mountedComponents } from '../component-view'
import { inComponentOverview } from '../component-zoom'

/** Takes keys of its own: any input, a textarea, a select or editable text (not app/intents.ts's isTextField). */
function isEditable(el: Element): boolean {
  return el.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}

/**
 * The diagram scope's state for a key on [target], or null when it is not in a diagram card, or
 * is in a text field (other than the card's Find) or a menu, which keep their keys.
 */
export function diagramKeyContext(
  target: EventTarget | null,
  page: { singleKeys: boolean; panelOpen: boolean },
): DiagramKeyContext | null {
  if (!(target instanceof Element)) return null
  const components = target.closest('.comp-diagram')
  if (components) return componentKeyContext(components, target, page)
  const card = target.closest('.seq-diagram')
  if (!card) return null
  const on = placeIn(target)
  if (!on) return null
  const scrollport = card.querySelector<HTMLElement>('.seq-scroll')
  const id = scrollport?.dataset.scenarioId
  const zoomable = Boolean(id && diagramState.mounted.has(id))
  return {
    on,
    zoomable,
    overview: zoomable && diagramView(id!).mode.kind === 'overview',
    panelOpen: page.panelOpen,
    singleKeys: page.singleKeys,
    messageId: messageIdAt(target, on),
    scrollport,
    target: target as HTMLElement,
  }
}

/**
 * In the Components view (#105) only the zoom keys apply: there are no messages to move between,
 * and its links take Enter and Space themselves.
 */
function componentKeyContext(
  view: Element,
  target: Element,
  page: { singleKeys: boolean; panelOpen: boolean },
): DiagramKeyContext | null {
  if (isEditable(target) || target.closest('[role="menu"]')) return null
  const scrollport = view.querySelector<HTMLElement>('.comp-scroll')
  const id = scrollport?.dataset.scenarioId
  const zoomable = Boolean(id && mountedComponents(id))
  return {
    on: 'card',
    zoomable,
    overview: zoomable && inComponentOverview(id!),
    panelOpen: page.panelOpen,
    singleKeys: page.singleKeys,
    messageId: null,
    scrollport,
    target: target as HTMLElement,
  }
}

function placeIn(target: Element): DiagramKeyContext['on'] | null {
  if (target.matches('[data-diagram-find]')) return 'find'
  if (isEditable(target) || target.closest('[role="menu"]')) return null
  const scroll = target.closest('.seq-scroll')
  if (scroll && target.closest('button.msg-open')) return 'arrow'
  if (scroll && target === scroll) return 'scrollport'
  if (target.closest('.message.has-data')) return 'link'
  return 'card'
}

function messageIdAt(target: Element, on: DiagramKeyContext['on']): string | null {
  if (on === 'arrow') return target.closest<HTMLElement>('button.msg-open')!.dataset.messageId ?? null
  if (on === 'link') return target.closest('.message.has-data')!.getAttribute('data-message-id')
  return null
}
