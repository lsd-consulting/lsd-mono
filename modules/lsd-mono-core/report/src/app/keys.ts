// Page-wide keyboard shortcuts.
import { paintThemeButton } from './chrome'
import { focusSelectedDiagram } from './main-view'
import { moveSelection, focusedNavId } from './nav'
import { toggleTheme } from '../ui/theme'
import { singleKeysEnabled } from '../ui/shortcuts'
import { session, state } from './context'
import { pageAction } from './key-bindings'

export function onKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement
  const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

  if (e.key === 'Escape') {
    if (session.inspector?.isOpen()) return
    if (state.helpOpen) {
      state.helpOpen = false
      document.querySelector('#help')!.setAttribute('data-open', 'false')
      e.preventDefault()
      return
    }
    if (typing) {
      ;(target as HTMLInputElement).blur()
      e.preventDefault()
    }
    return
  }

  if (typing) return
  if (target.closest('button.msg-open')) return
  if (target.closest('[data-show-components]')) return
  if (target.closest('[data-show-metrics]')) return
  if (target.closest('#inspector')) return
  if (target.closest('.seq-scroll')) return

  // j/k anywhere outside a text box; arrows only on the list, the page or the scenario
  // heading, so they keep their own meaning in the diagram toolbar and its popovers.
  // On the list, focus follows the selection. Enter on a focused button presses that
  // button (a list item, filters, theme…); anywhere else it goes into the shown diagram.
  const action = pageAction(e, {
    arrows: Boolean(target === document.body || target.closest('#scenario-nav') || target.matches('#scenario-title')),
    onControl: Boolean(target.closest('button, a, [role="slider"]')),
    hasScenario: Boolean(session.renderedId),
    singleKeys: singleKeysEnabled(),
  })
  if (!action || action === 'close') return
  e.preventDefault()
  switch (action) {
    case 'search':
      document.querySelector<HTMLInputElement>('#search')?.focus()
      return
    case 'next':
      moveSelection(1, focusedNavId(target))
      return
    case 'prev':
      moveSelection(-1, focusedNavId(target))
      return
    case 'diagram':
      focusSelectedDiagram()
      return
    case 'theme':
      paintThemeButton(toggleTheme())
      return
    case 'help':
      state.helpOpen = !state.helpOpen
      document.querySelector('#help')!.setAttribute('data-open', String(state.helpOpen))
  }
}
