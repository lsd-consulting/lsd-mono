export type Theme = 'dark' | 'light' | 'contrast'

const KEY = 'lsd-report-theme'
const ORDER: Theme[] = ['dark', 'light', 'contrast']

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

export function readStoredTheme(stored: string | null, prefersLight: boolean): Theme {
  if (isTheme(stored)) return stored
  return prefersLight ? 'light' : 'dark'
}

export function getPreferredTheme(): Theme {
  const stored = localStorage.getItem(KEY)
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
  return readStoredTheme(stored, prefersLight)
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(KEY, theme)
}

export function toggleTheme(): Theme {
  const next = nextTheme(getPreferredTheme())
  applyTheme(next)
  return next
}
