// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  chooseMode,
  chooseTheme,
  currentMode,
  followOsTheme,
  followOtherTabs,
  forgetLegacyTheme,
  getPreferredTheme,
  LEGACY_THEME_KEY,
  modeOf,
  nextMode,
  osTheme,
  resolveTheme,
  THEME_KEY,
  THEME_MODES,
  themeButtonLabel,
  themeIcon,
  toggleTheme,
  type Theme,
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
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('theme cycle (`d`)', () => {
  it('steps Auto, light, dark, high contrast, skipping a step that shows the same theme (#106)', () => {
    // Auto showing dark: dark would change nothing on screen but stop following the OS.
    expect(nextMode('auto', 'dark')).toBe('light')
    expect(nextMode('auto', 'light')).toBe('dark')
    expect(nextMode('auto', 'contrast')).toBe('light')
    expect(nextMode('light', 'dark')).toBe('dark')
    expect(nextMode('dark', 'dark')).toBe('contrast')
    expect(nextMode('contrast', 'dark')).toBe('auto')
    // High contrast from the OS: from a pinned high contrast, Auto would show it again.
    expect(nextMode('dark', 'contrast')).toBe('contrast')
    expect(nextMode('contrast', 'contrast')).toBe('light')
  })

  it('never steps to a mode that leaves the page as it was', () => {
    for (const os of ['dark', 'light', 'contrast'] as Theme[]) {
      for (const mode of THEME_MODES) {
        const next = nextMode(mode, os)
        const show = (m: typeof mode) => (m === 'auto' ? os : m)
        expect(show(next), `${mode} on ${os}`).not.toBe(show(mode))
      }
    }
  })
})

describe('theme button', () => {
  it('shows the current mode: A, a sun for light, a moon for dark, HC (#106)', () => {
    expect(themeIcon('auto')).toBe('A')
    expect(themeIcon('light')).toBe('sun')
    expect(themeIcon('dark')).toBe('moon')
    expect(themeIcon('contrast')).toBe('HC')
  })

  it('names the current mode in text, with the theme Auto shows', () => {
    expect(themeButtonLabel('auto', 'dark')).toBe('A. Theme: Auto (dark)')
    expect(themeButtonLabel('auto', 'contrast')).toBe('A. Theme: Auto (high contrast)')
    expect(themeButtonLabel('dark', 'dark')).toBe('Theme: dark')
    expect(themeButtonLabel('light', 'light')).toBe('Theme: light')
    expect(themeButtonLabel('contrast', 'contrast')).toBe('HC. Theme: high contrast')
  })

  it('starts the accessible name with the visible text when the icon is text', () => {
    for (const mode of THEME_MODES) {
      const icon = themeIcon(mode)
      const label = themeButtonLabel(mode, mode === 'auto' ? 'dark' : mode)
      const text = icon === 'A' || icon === 'HC'
      expect(label.startsWith(`${icon}. `), `${mode}: ${label}`).toBe(text)
    }
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

  it('toggles through the modes, storing fixed choices and clearing the store for Auto', () => {
    fakeOs({ light: true })
    applyTheme('light')
    expect(currentMode()).toBe('auto')
    expect(toggleTheme()).toEqual({ mode: 'dark', theme: 'dark' })
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(toggleTheme()).toEqual({ mode: 'contrast', theme: 'contrast' })
    expect(shown()).toBe('contrast')
    expect(currentMode()).toBe('contrast')
    expect(toggleTheme()).toEqual({ mode: 'auto', theme: 'light' })
    expect(shown()).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(currentMode()).toBe('auto')
  })

  it('Auto resumes following the OS live after a fixed choice', () => {
    const os = fakeOs()
    const seen: string[] = []
    followOsTheme((t) => seen.push(t))
    chooseTheme('light')
    os.set({ light: true })
    os.set({ light: false })
    expect(shown()).toBe('light')
    expect(chooseMode('auto')).toBe('dark')
    os.set({ moreContrast: true })
    expect(shown()).toBe('contrast')
    expect(seen).toEqual(['contrast'])
  })
})

describe('stored key (#106)', () => {
  it('is versioned, and the pre-#106 key is dropped, not read', () => {
    expect(THEME_KEY).not.toBe(LEGACY_THEME_KEY)
    localStorage.setItem(LEGACY_THEME_KEY, 'dark')
    expect(currentMode()).toBe('auto')
    forgetLegacyTheme()
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull()
  })

  it('reads anything but a theme as Auto', () => {
    expect(modeOf('light')).toBe('light')
    expect(modeOf(null)).toBe('auto')
    expect(modeOf('auto')).toBe('auto')
  })

  it('survives storage that throws when forgetting the old key', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => forgetLegacyTheme()).not.toThrow()
  })
})

describe('followOtherTabs', () => {
  const fire = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }))

  it('repaints when another tab stores or clears a choice, and ignores other keys', () => {
    fakeOs({ light: true })
    const seen: unknown[] = []
    const stop = followOtherTabs((c) => seen.push(c))
    localStorage.setItem(THEME_KEY, 'contrast')
    fire(THEME_KEY)
    expect(shown()).toBe('contrast')
    fire('something-else')
    localStorage.removeItem(THEME_KEY)
    fire(null)
    expect(shown()).toBe('light')
    expect(seen).toEqual([
      { mode: 'contrast', theme: 'contrast' },
      { mode: 'auto', theme: 'light' },
    ])
    stop()
    fire(THEME_KEY)
    expect(seen).toHaveLength(2)
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
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(chooseMode('auto')).toBe('light')
    expect(currentMode()).toBe('auto')
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
    const boot = head.indexOf('data-theme-boot')
    // The styles come with the module script (bundled, fonts included); a stylesheet link, if one is added, must follow.
    const stylesheet = head.indexOf('stylesheet')
    expect(stylesheet === -1 || boot < stylesheet).toBe(true)
    expect(html.indexOf('<script type="module"')).toBeGreaterThan(boot)
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

  it('drops the pre-#106 key before first paint, so an old choice gives Auto', () => {
    fakeOs({ light: true })
    localStorage.setItem(LEGACY_THEME_KEY, 'dark')
    run()
    expect(shown()).toBe('light')
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull()
  })
})
