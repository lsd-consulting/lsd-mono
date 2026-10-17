export type Theme = 'dark' | 'light' | 'contrast'
/** What the user picked: a fixed theme, or Auto (no stored choice; the OS decides, live). */
export type ThemeMode = Theme | 'auto'

/** Holds an explicit choice only. With nothing stored the report follows the OS. */
export const THEME_KEY = 'lsd-report-theme'
const ORDER: ThemeMode[] = ['auto', 'dark', 'light', 'contrast']
const LIGHT = '(prefers-color-scheme: light)'
const MORE_CONTRAST = '(prefers-contrast: more)'

function isTheme(value: string | null): value is Theme {
  return value === 'dark' || value === 'light' || value === 'contrast'
}

/** Next mode in the cycle Auto → dark → light → high contrast → Auto. */
export function nextMode(current: ThemeMode): ThemeMode {
  const index = ORDER.indexOf(current)
  return ORDER[(index + 1) % ORDER.length]
}

export function themeGlyph(mode: ThemeMode): string {
  if (mode === 'auto') return 'A'
  if (mode === 'contrast') return 'HC'
  return mode === 'dark' ? '☀' : '☾'
}

function themeName(theme: Theme): string {
  return theme === 'contrast' ? 'high contrast' : theme
}

function modeName(mode: ThemeMode, shown?: Theme): string {
  if (mode !== 'auto') return themeName(mode)
  return shown ? `Auto (${themeName(shown)})` : 'Auto (follow the OS)'
}

/**
 * Names the current mode (with the theme Auto resolved to) and the next one,
 * e.g. "Theme: Auto (dark). Switch to dark". Not a colour-only control.
 */
export function themeButtonLabel(mode: ThemeMode, shown: Theme): string {
  return `Theme: ${modeName(mode, shown)}. Switch to ${modeName(nextMode(mode))}`
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

/** A stored explicit choice wins; otherwise the OS decides. Unknown stored values are ignored. */
export function resolveTheme(stored: string | null, os: OsPreference): Theme {
  return isTheme(stored) ? stored : osTheme(os)
}

/** The stored choice, or Auto when there is none. */
export function currentMode(): ThemeMode {
  const stored = storedChoice()
  return isTheme(stored) ? stored : 'auto'
}

function storedChoice(): string | null {
  try {
    return localStorage.getItem(THEME_KEY)
  } catch {
    return null
  }
}

function osPreference(): OsPreference {
  const m = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches
  return { light: m(LIGHT), moreContrast: m(MORE_CONTRAST) }
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
  const theme = osTheme(osPreference())
  applyTheme(theme)
  return theme
}

/** Steps the theme button / `d` cycle. Returns the new mode and the theme it shows. */
export function toggleTheme(): { mode: ThemeMode; theme: Theme } {
  const mode = nextMode(currentMode())
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
    const theme = osTheme(osPreference())
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
