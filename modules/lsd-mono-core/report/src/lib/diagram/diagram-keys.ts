// Where in a diagram card a key was pressed (#102), read from the DOM for the key router.
import type { DiagramKeyContext } from '../keys/bindings'
import { diagramState, diagramView } from './state'

function isTextField(el: Element): boolean {
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

function placeIn(target: Element): DiagramKeyContext['on'] | null {
  if (target.matches('[data-diagram-find]')) return 'find'
  if (isTextField(target) || target.closest('[role="menu"]')) return null
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
