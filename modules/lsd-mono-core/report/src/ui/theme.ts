export type Theme = 'dark' | 'light' | 'contrast'

/** Holds an explicit choice only. With nothing stored the report follows the OS. */
export const THEME_KEY = 'lsd-report-theme'
const ORDER: Theme[] = ['dark', 'light', 'contrast']
const LIGHT = '(prefers-color-scheme: light)'
const MORE_CONTRAST = '(prefers-contrast: more)'

export function isTheme(value: string | null): value is Theme {
  return value === 'dark' || value === 'light' || value === 'contrast'
}

/** Next theme in the cycle dark → light → high contrast → dark. */
export function nextTheme(current: Theme): Theme {
  const index = ORDER.indexOf(current)
  return ORDER[(index + 1) % ORDER.length]
}

export function themeGlyph(theme: Theme): string {
  if (theme === 'contrast') return 'HC'
  return theme === 'dark' ? '☀' : '☾'
}

export function themeName(theme: Theme): string {
  return theme === 'contrast' ? 'high contrast' : theme
}

/** Names the current theme and the next one. Not a colour-only control. */
export function themeButtonLabel(theme: Theme): string {
  return `Theme: ${themeName(theme)}. Switch to ${themeName(nextTheme(theme))}`
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

export function toggleTheme(): Theme {
  const current = document.documentElement.getAttribute('data-theme')
  const next = nextTheme(isTheme(current) ? current : getPreferredTheme())
  chooseTheme(next)
  return next
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
