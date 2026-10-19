/** Holds an explicit choice only: `off`. With nothing stored the single-key shortcuts are on. */
export const SINGLE_KEYS_KEY = 'lsd-report-single-keys'

/**
 * Whether the page's one-character shortcuts (/ j k d ?) are on. WCAG 2.1.4: a person who dictates
 * or has tremors can turn them off, and the modifier shortcuts (Ctrl or Cmd+K) keep working.
 */
export function singleKeysEnabled(): boolean {
  try {
    return localStorage.getItem(SINGLE_KEYS_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Remember the choice, as the theme is remembered. Storage off: it lasts for this page only. */
export function setSingleKeys(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SINGLE_KEYS_KEY)
    else localStorage.setItem(SINGLE_KEYS_KEY, 'off')
  } catch {
    // Storage off (private mode, file:// policy).
  }
}
