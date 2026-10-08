/** Collapsed scenario list (icon rail). Remembered in localStorage, like the theme. */
const KEY = 'lsd-report-sidebar'

export function readStoredSidebar(stored: string | null): boolean {
  return stored === 'collapsed'
}

export function getSidebarCollapsed(): boolean {
  try {
    return readStoredSidebar(localStorage.getItem(KEY))
  } catch {
    return false
  }
}

export function storeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? 'collapsed' : 'expanded')
  } catch {
    // Storage can be off (private mode, file:// policies). The toggle still works for this page.
  }
}

/** Names what the button will do, so screen readers hear the action. */
export function sidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? 'Expand scenario list' : 'Collapse scenario list'
}

export function sidebarToggleGlyph(collapsed: boolean): string {
  return collapsed ? '»' : '«'
}

/** Tooltip for a rail item, where only the status dot and number are painted. */
export function navItemTooltip(title: string, status: string, messages: number): string {
  return `${title}. ${status} · ${messages} messages`
}

export function applySidebarCollapsed(shell: Element | null, button: Element | null, collapsed: boolean): void {
  shell?.classList.toggle('sidebar-collapsed', collapsed)
  if (!button) return
  const label = sidebarToggleLabel(collapsed)
  button.setAttribute('aria-expanded', String(!collapsed))
  button.setAttribute('aria-label', label)
  button.setAttribute('title', label)
  button.textContent = sidebarToggleGlyph(collapsed)
}
