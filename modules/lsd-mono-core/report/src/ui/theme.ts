export type Theme = 'dark' | 'light' | 'contrast'
/** What the user picked: a fixed theme, or Auto (no stored choice; the OS decides, live). */
export type ThemeMode = Theme | 'auto'

/**
 * Holds an explicit choice only. With nothing stored the report follows the OS. Versioned in
 * #106: the old key held choices stored before Auto existed, or by a first press that changed
 * nothing on screen, so it is dropped once and everyone starts on Auto again.
 */
export const THEME_KEY = 'lsd-report-theme-v2'
export const LEGACY_THEME_KEY = 'lsd-report-theme'
/** The menu order, and the `d` cycle. */
export const THEME_MODES: readonly ThemeMode[] = ['auto', 'light', 'dark', 'contrast']
const LIGHT = '(prefers-color-scheme: light)'
const MORE_CONTRAST = '(prefers-contrast: more)'

function isTheme(value: string | null): value is Theme {
  return value === 'dark' || value === 'light' || value === 'contrast'
}

export interface OsPreference {
  light: boolean
  moreContrast: boolean
}

/** The OS default: high contrast when asked for more contrast, else light or dark. */
export function osTheme(os: OsPreference): Theme {
  if (os.moreContrast) return 'contrast'
  return os.light ? 'light' : 'dark'
}

/** The theme a mode shows, given what the OS asks for. */
export function shownTheme(mode: ThemeMode, os: Theme): Theme {
  return mode === 'auto' ? os : mode
}

/**
 * The `d` cycle Auto → light → dark → high contrast → Auto, skipping any step that would leave
 * the page as it is: from Auto showing light, the next step is dark, not a pinned light.
 */
export function nextMode(current: ThemeMode, os: Theme): ThemeMode {
  const shown = shownTheme(current, os)
  const start = THEME_MODES.indexOf(current)
  for (let step = 1; step < THEME_MODES.length; step++) {
    const mode = THEME_MODES[(start + step) % THEME_MODES.length]
    if (shownTheme(mode, os) !== shown) return mode
  }
  return current
}

/** The current mode as text, or the name of the icon it draws: A, HC, a sun (light), a moon (dark). */
export function themeIcon(mode: ThemeMode): 'A' | 'HC' | 'sun' | 'moon' {
  if (mode === 'auto') return 'A'
  if (mode === 'contrast') return 'HC'
  return mode === 'light' ? 'sun' : 'moon'
}

function themeName(theme: Theme): string {
  return theme === 'contrast' ? 'high contrast' : theme
}

/** "Auto (dark)", "light", "high contrast": the mode, with the theme Auto shows. */
export function modeName(mode: ThemeMode, shown: Theme): string {
  return mode === 'auto' ? `Auto (${themeName(shown)})` : themeName(mode)
}

/**
 * The theme button's name: the current mode, e.g. "A. Theme: Auto (dark)". Not a colour-only
 * control. A text icon ("A", "HC") leads the name, so the visible label is part of the
 * accessible name (WCAG 2.5.3, axe label-content-name-mismatch); the sun and moon are drawn.
 */
export function themeButtonLabel(mode: ThemeMode, shown: Theme): string {
  const icon = themeIcon(mode)
  const visible = icon === 'A' || icon === 'HC' ? `${icon}. ` : ''
  return `${visible}Theme: ${modeName(mode, shown)}`
}

/** A stored explicit choice wins; otherwise the OS decides. Unknown stored values are ignored. */
export function resolveTheme(stored: string | null, os: OsPreference): Theme {
  return isTheme(stored) ? stored : osTheme(os)
}

/** The mode a stored value means: the theme, or Auto for nothing (or anything unknown). */
export function modeOf(stored: string | null): ThemeMode {
  return isTheme(stored) ? stored : 'auto'
}

/** The stored choice, or Auto when there is none. */
export function currentMode(): ThemeMode {
  return modeOf(storedChoice())
}

function storedChoice(): string | null {
  try {
    return localStorage.getItem(THEME_KEY)
  } catch {
    return null
  }
}

/** Drops the pre-#106 key. The head script does this before first paint too. */
export function forgetLegacyTheme(): void {
  try {
    localStorage.removeItem(LEGACY_THEME_KEY)
  } catch {
    // Storage off: nothing was stored.
  }
}

function osPreference(): OsPreference {
  const m = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches
  return { light: m(LIGHT), moreContrast: m(MORE_CONTRAST) }
}

function currentOsTheme(): Theme {
  return osTheme(osPreference())
}

export function getPreferredTheme(): Theme {
  return resolveTheme(storedChoice(), osPreference())
}

/** Shows a theme without remembering it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/** An explicit choice: shown and remembered, so it wins over the OS from now on. */
export function chooseTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Storage off (private mode, file:// policy): the choice lasts for this page only.
  }
}

/** Auto forgets the stored choice and shows the OS theme; any other mode is a choice. Returns the theme shown. */
export function chooseMode(mode: ThemeMode): Theme {
  if (mode !== 'auto') {
    chooseTheme(mode)
    return mode
  }
  try {
    localStorage.removeItem(THEME_KEY)
  } catch {
    // Storage off: nothing was stored to forget.
  }
  const theme = currentOsTheme()
  applyTheme(theme)
  return theme
}

/** Steps the `d` cycle. Returns the new mode and the theme it shows. */
export function toggleTheme(): { mode: ThemeMode; theme: Theme } {
  const mode = nextMode(currentMode(), currentOsTheme())
  return { mode, theme: chooseMode(mode) }
}

/**
 * Follows OS colour-scheme and contrast changes live while no explicit choice is stored.
 * Calls `onChange` with the theme it applied. Returns a function that stops listening.
 */
export function followOsTheme(onChange: (theme: Theme) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const queries = [matchMedia(LIGHT), matchMedia(MORE_CONTRAST)]
  const update = () => {
    if (isTheme(storedChoice())) return
    const theme = currentOsTheme()
    // Both queries can fire for one OS change; act once.
    if (document.documentElement.getAttribute('data-theme') === theme) return
    applyTheme(theme)
    onChange(theme)
  }
  for (const q of queries) q.addEventListener('change', update)
  return () => {
    for (const q of queries) q.removeEventListener('change', update)
  }
}

/**
 * Follows a choice made in another tab of the same origin: the `storage` event fires there, not
 * in the tab that wrote it. Calls `onChange` with the mode and the theme it applied.
 */
export function followOtherTabs(onChange: (choice: { mode: ThemeMode; theme: Theme }) => void): () => void {
  const update = (e: StorageEvent) => {
    // A null key is localStorage.clear().
    if (e.key !== THEME_KEY && e.key !== null) return
    const mode = currentMode()
    const theme = shownTheme(mode, currentOsTheme())
    applyTheme(theme)
    onChange({ mode, theme })
  }
  window.addEventListener('storage', update)
  return () => window.removeEventListener('storage', update)
}
