import { describe, expect, it } from 'vitest'
import { nextTheme, readStoredTheme, themeButtonLabel, themeGlyph } from './theme'

describe('theme cycle', () => {
  it('cycles dark, light, then high contrast', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('contrast')
    expect(nextTheme('contrast')).toBe('dark')
  })

  it('persists a stored high-contrast value and ignores unknown values', () => {
    expect(readStoredTheme('contrast', false)).toBe('contrast')
    expect(readStoredTheme('light', false)).toBe('light')
    expect(readStoredTheme('nope', true)).toBe('light')
    expect(readStoredTheme(null, false)).toBe('dark')
  })

  it('names the theme in text, not colour alone', () => {
    expect(themeGlyph('contrast')).toBe('HC')
    expect(themeButtonLabel('light')).toContain('high contrast')
    expect(themeButtonLabel('contrast')).toContain('Theme: high contrast')
  })
})
