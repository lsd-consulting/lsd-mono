// Page-wide keyboard shortcuts.
import { paintThemeButton } from './chrome'
import { focusSelectedDiagram } from './main-view'
import { moveSelection, focusedNavId } from './nav'
import { toggleTheme } from '../ui/theme'
import { session, state } from './context'

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

  if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#search')?.focus()
    return
  }
  // j/k anywhere outside a text box; arrows only on the list, the page or the scenario
  // heading, so they keep their own meaning in the diagram toolbar and its popovers.
  // On the list, focus follows the selection.
  const arrows = target === document.body || target.closest('#scenario-nav') || target.matches('#scenario-title')
  if (e.key === 'j' || (e.key === 'ArrowDown' && arrows)) {
    e.preventDefault()
    moveSelection(1, focusedNavId(target))
    return
  }
  if (e.key === 'k' || (e.key === 'ArrowUp' && arrows)) {
    e.preventDefault()
    moveSelection(-1, focusedNavId(target))
    return
  }
  // Enter on a focused button presses that button (a list item, filters, theme…).
  // Anywhere else it goes into the shown scenario's diagram.
  if (e.key === 'Enter' && target.closest('button, a, [role="slider"]')) return
  if (e.key === 'Enter' && session.renderedId) {
    e.preventDefault()
    focusSelectedDiagram()
    return
  }
  if (e.key === 'd') {
    e.preventDefault()
    paintThemeButton(toggleTheme())
    return
  }
  if (e.key === '?') {
    e.preventDefault()
    state.helpOpen = !state.helpOpen
    document.querySelector('#help')!.setAttribute('data-open', String(state.helpOpen))
  }
}
