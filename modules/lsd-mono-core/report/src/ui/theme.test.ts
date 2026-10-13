// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  chooseTheme,
  followOsTheme,
  getPreferredTheme,
  nextTheme,
  osTheme,
  resolveTheme,
  THEME_KEY,
  themeButtonLabel,
  themeGlyph,
  toggleTheme,
} from './theme'

/** A fake OS: flip `light` / `moreContrast` and fire change events like a browser does. */
function fakeOs(initial: { light?: boolean; moreContrast?: boolean } = {}) {
  const os = { light: false, moreContrast: false, ...initial }
  const listeners = new Map<string, Set<() => void>>()
  const matches = (query: string) =>
    query.includes('light') ? os.light : query.includes('contrast') ? os.moreContrast : false
  const mql = (query: string) => ({
    get matches() {
      return matches(query)
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query)!.add(fn)
    },
    removeEventListener: (_: string, fn: () => void) => listeners.get(query)?.delete(fn),
  })
  vi.stubGlobal('matchMedia', mql)
  return {
    set(next: { light?: boolean; moreContrast?: boolean }) {
      // Like a browser, only a query whose result changed fires.
      const before = new Map([...listeners.keys()].map((q) => [q, matches(q)]))
      Object.assign(os, next)
      for (const [q, set] of listeners) if (before.get(q) !== matches(q)) for (const fn of set) fn()
    },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  }
}

const shown = () => document.documentElement.getAttribute('data-theme')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.setAttribute('data-theme', 'dark')
})
afterEach(() => vi.unstubAllGlobals())

describe('theme cycle', () => {
  it('cycles dark, light, then high contrast', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('contrast')
    expect(nextTheme('contrast')).toBe('dark')
  })

  it('names the theme in text, not colour alone', () => {
    expect(themeGlyph('contrast')).toBe('HC')
    expect(themeButtonLabel('light')).toContain('high contrast')
    expect(themeButtonLabel('contrast')).toContain('Theme: high contrast')
  })
})

describe('OS default and explicit choice', () => {
  it('maps the OS colour scheme, and more contrast to high contrast', () => {
    expect(osTheme({ light: false, moreContrast: false })).toBe('dark')
    expect(osTheme({ light: true, moreContrast: false })).toBe('light')
    expect(osTheme({ light: false, moreContrast: true })).toBe('contrast')
  })

  it('lets a stored choice (high contrast included) win, and ignores unknown values', () => {
    expect(resolveTheme('contrast', { light: true, moreContrast: false })).toBe('contrast')
    expect(resolveTheme('dark', { light: true, moreContrast: false })).toBe('dark')
    expect(resolveTheme('nope', { light: true, moreContrast: false })).toBe('light')
    expect(resolveTheme(null, { light: false, moreContrast: false })).toBe('dark')
  })

  it('reads the live OS when nothing is stored', () => {
    fakeOs({ light: true })
    expect(getPreferredTheme()).toBe('light')
    localStorage.setItem(THEME_KEY, 'contrast')
    expect(getPreferredTheme()).toBe('contrast')
  })

  it('shows the OS default without storing it; only a choice is stored', () => {
    applyTheme('light')
    expect(shown()).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    chooseTheme('contrast')
    expect(localStorage.getItem(THEME_KEY)).toBe('contrast')
  })

  it('toggles from the theme on screen and stores the result', () => {
    fakeOs({ light: true })
    applyTheme('light')
    expect(toggleTheme()).toBe('contrast')
    expect(shown()).toBe('contrast')
    expect(localStorage.getItem(THEME_KEY)).toBe('contrast')
  })
})

describe('followOsTheme', () => {
  it('follows OS changes live until the user chooses, then stops changing', () => {
    const os = fakeOs()
    const seen: string[] = []
    const stop = followOsTheme((t) => seen.push(t))
    os.set({ light: true })
    expect(shown()).toBe('light')
    os.set({ moreContrast: true })
    expect(shown()).toBe('contrast')
    os.set({ light: false, moreContrast: false })
    expect(shown()).toBe('dark')
    expect(seen).toEqual(['light', 'contrast', 'dark'])

    chooseTheme('light')
    os.set({ light: false })
    expect(shown()).toBe('light')
    expect(seen).toHaveLength(3)

    stop()
    expect(os.listenerCount()).toBe(0)
  })

  it('is a no-op without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(getPreferredTheme()).toBe('dark')
    const stop = followOsTheme(() => {
      throw new Error('should not be called')
    })
    stop()
  })

  it('survives storage that throws', () => {
    fakeOs({ light: true })
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(getPreferredTheme()).toBe('light')
    chooseTheme('dark')
    expect(shown()).toBe('dark')
    spy.mockRestore()
    set.mockRestore()
  })
})

describe('pre-paint script in index.html', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
  const script = html.match(/<script data-theme-boot>([\s\S]*?)<\/script>/)![1]
  // Runs the page's own inline script text, exactly as shipped; there is nothing else to call.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = () => void (new Function(script) as () => void)()

  it('sits in the head, before any stylesheet, and is not the module script', () => {
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toContain('<script data-theme-boot>')
    expect(head.indexOf('data-theme-boot')).toBeLessThan(head.indexOf('stylesheet'))
  })

  it.each([
    [null, { light: false, moreContrast: false }],
    [null, { light: true, moreContrast: false }],
    [null, { light: true, moreContrast: true }],
    ['dark', { light: true, moreContrast: true }],
    ['contrast', { light: false, moreContrast: false }],
    ['bogus', { light: true, moreContrast: false }],
  ] as const)('agrees with resolveTheme for stored %s and OS %o', (stored, os) => {
    fakeOs(os)
    if (stored) localStorage.setItem(THEME_KEY, stored)
    run()
    expect(shown()).toBe(resolveTheme(stored, os))
  })
})
