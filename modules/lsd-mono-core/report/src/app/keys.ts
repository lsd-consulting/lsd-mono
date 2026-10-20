// Page-wide keyboard shortcuts.
import { focusSelectedDiagram } from './main-view'
import { moveSelection, focusedNavId } from './nav'
import { toggleTheme } from '../ui/theme'
import { paintThemeControl } from '../ui/theme-menu'
import { singleKeysEnabled } from '../ui/shortcuts'
import { session, state } from './context'
import { keyTarget, pageKeyIntent } from './intents'

export function onKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement
  // One Escape closes one thing (#102): the side panel's own listener runs first and takes it.
  if (e.key === 'Escape' && e.defaultPrevented) return
  // j/k anywhere outside a text box; arrows only on the list, the page or the scenario
  // heading, so they keep their own meaning in the diagram toolbar and its popovers.
  // On the list, focus follows the selection. Enter on a focused button presses that
  // button (a list item, filters, theme…); anywhere else it goes into the shown diagram.
  const intent = pageKeyIntent(e, keyTarget(target), {
    inspectorOpen: Boolean(session.inspector?.isOpen()),
    helpOpen: state.helpOpen,
    hasScenario: Boolean(session.renderedId),
    singleKeys: singleKeysEnabled(),
  })
  if (!intent) return
  e.preventDefault()
  switch (intent) {
    case 'close-help':
      state.helpOpen = false
      document.querySelector('#help')!.setAttribute('data-open', 'false')
      return
    case 'blur':
      ;(target as HTMLInputElement).blur()
      return
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
      paintThemeControl(toggleTheme())
      return
    case 'help':
      state.helpOpen = !state.helpOpen
      document.querySelector('#help')!.setAttribute('data-open', String(state.helpOpen))
  }
}
