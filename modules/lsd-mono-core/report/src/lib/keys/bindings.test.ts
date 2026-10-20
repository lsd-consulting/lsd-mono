import { describe, expect, it } from 'vitest'
import {
  KEY_BINDINGS,
  KEY_SCOPES,
  keyHelpHtml,
  matchingBindings,
  singleKeysLabelHtml,
  type DiagramKeyContext,
  type KeyBinding,
  type KeyEvent,
  type KeyScope,
  type PageKeyContext,
  type ScopeContexts,
} from './bindings'

const page: PageKeyContext = {
  typing: false,
  ownKeys: false,
  arrows: true,
  onControl: false,
  inMenu: false,
  hasScenario: true,
  singleKeys: true,
}
const key = (k: string, mods: Omit<KeyEvent, 'key'> = {}): KeyEvent => ({ key: k, ...mods })
/** The page binding [e] runs, or null. */
const pageAction = (e: KeyEvent, ctx: PageKeyContext = page) => {
  const ids = matchingBindings('page', e, ctx).map((b) => b.id)
  return ids[0] ?? null
}

describe('page key bindings', () => {
  it('maps each page key to its action', () => {
    expect(pageAction(key('/'))).toBe('search')
    expect(pageAction(key('k', { metaKey: true }))).toBe('search')
    expect(pageAction(key('k', { ctrlKey: true }))).toBe('search')
    expect(pageAction(key('j'))).toBe('next')
    expect(pageAction(key('k'))).toBe('prev')
    expect(pageAction(key('ArrowDown'))).toBe('next')
    expect(pageAction(key('ArrowUp'))).toBe('prev')
    expect(pageAction(key('Enter'))).toBe('diagram')
    expect(pageAction(key('d'))).toBe('theme')
    expect(pageAction(key('?'))).toBe('help')
    expect(pageAction(key('x'))).toBeNull()
  })

  it('lets go of a text field on Escape, else does nothing; the help closes before (dialog scope)', () => {
    expect(pageAction(key('Escape'), { ...page, typing: true })).toBe('blur')
    expect(pageAction(key('Escape'))).toBeNull()
    expect(matchingBindings('dialog', key('Escape'), { open: true }).map((b) => b.id)).toEqual(['close-help'])
    expect(matchingBindings('dialog', key('Escape'), { open: false })).toEqual([])
  })

  it('closes one layer per Escape press: not while it is held down, and not with Ctrl, Cmd or Alt', () => {
    for (const [scope, ctx] of [
      ['dialog', { open: true }],
      ['panel', { open: true }],
    ] as const) {
      expect(matchingBindings(scope, key('Escape'), ctx).length, scope).toBe(1)
      expect(matchingBindings(scope, key('Escape', { shiftKey: true }), ctx).length, scope).toBe(1)
      for (const mods of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }])
        expect(matchingBindings(scope, key('Escape', mods), ctx), `${scope} ${Object.keys(mods)[0]}`).toEqual([])
    }
  })

  it('keeps off text fields and controls with keys of their own', () => {
    expect(pageAction(key('j'), { ...page, typing: true })).toBeNull()
    expect(pageAction(key('k', { metaKey: true }), { ...page, typing: true })).toBeNull()
    expect(pageAction(key('j'), { ...page, ownKeys: true })).toBeNull()
    expect(pageAction(key('k', { metaKey: true }), { ...page, onControl: true })).toBe('search')
  })

  it('opens the help from anywhere but a text field or an open menu, an arrow and the side panel too', () => {
    expect(pageAction(key('?'), { ...page, ownKeys: true })).toBe('help')
    expect(pageAction(key('?'), { ...page, onControl: true })).toBe('help')
    expect(pageAction(key('?'), { ...page, typing: true })).toBeNull()
    expect(pageAction(key('?'), { ...page, inMenu: true })).toBeNull()
    expect(pageAction(key('?'), { ...page, ownKeys: true, singleKeys: false })).toBeNull()
  })

  it('leaves arrows and Enter alone where they mean something else', () => {
    expect(pageAction(key('ArrowDown'), { ...page, arrows: false })).toBeNull()
    expect(pageAction(key('j'), { ...page, arrows: false })).toBe('next')
    expect(pageAction(key('Enter'), { ...page, onControl: true })).toBeNull()
    expect(pageAction(key('Enter'), { ...page, hasScenario: false })).toBeNull()
  })

  it('does nothing for the one-character shortcuts when they are off, and keeps the rest', () => {
    const off = { ...page, singleKeys: false }
    for (const k of ['/', 'j', 'k', 'd', '?']) expect(pageAction(key(k), off), k).toBeNull()
    // Modifier shortcuts, arrows, Enter and Escape are not character keys.
    expect(pageAction(key('k', { metaKey: true }), off)).toBe('search')
    expect(pageAction(key('k', { ctrlKey: true }), off)).toBe('search')
    expect(pageAction(key('ArrowDown'), off)).toBe('next')
    expect(pageAction(key('ArrowUp'), off)).toBe('prev')
    expect(pageAction(key('Enter'), off)).toBe('diagram')
    expect(pageAction(key('Escape'), { ...off, typing: true })).toBe('blur')
  })

  it('does not take j, d or / with Ctrl, Cmd or Alt held, so browser shortcuts stay theirs', () => {
    for (const k of ['/', 'j', 'd', '?']) {
      expect(pageAction(key(k, { ctrlKey: true })), `ctrl ${k}`).toBeNull()
      expect(pageAction(key(k, { metaKey: true })), `cmd ${k}`).toBeNull()
      expect(pageAction(key(k, { altKey: true })), `alt ${k}`).toBeNull()
    }
  })
})

describe('side panel and diagram key bindings', () => {
  const card: DiagramKeyContext = {
    on: 'card',
    zoomable: true,
    overview: false,
    panelOpen: false,
    singleKeys: true,
    messageId: null,
    scrollport: null,
    target: null as unknown as HTMLElement,
  }
  const ids = (e: KeyEvent, ctx: DiagramKeyContext) => matchingBindings('diagram', e, ctx).map((b) => b.id)

  it('closes the side panel on Escape only while it is open', () => {
    expect(matchingBindings('panel', key('Escape'), { open: true }).map((b) => b.id)).toEqual(['close-panel'])
    expect(matchingBindings('panel', key('Escape'), { open: false })).toEqual([])
  })

  it('zooms anywhere in a mounted card but Find, and leaves Overview on Escape unless the panel is open', () => {
    expect(ids(key('+'), card)).toEqual(['zoom-in'])
    expect(ids(key('='), { ...card, on: 'arrow' })).toEqual(['zoom-in'])
    expect(ids(key('−'), { ...card, on: 'link' })).toEqual(['zoom-out'])
    expect(ids(key('0', { shiftKey: true }), { ...card, on: 'scrollport' })).toEqual(['zoom-reset'])
    expect(ids(key('!', { shiftKey: true, code: 'Digit1' }), card)).toEqual(['overview'])
    expect(ids(key('+'), { ...card, on: 'find' })).toEqual([])
    expect(ids(key('+'), { ...card, zoomable: false })).toEqual([])
    expect(ids(key('+'), { ...card, singleKeys: false })).toEqual([])
    expect(ids(key('Escape'), { ...card, overview: true })).toEqual(['leave-overview'])
    expect(ids(key('Escape'), { ...card, overview: true, panelOpen: true })).toEqual([])
    expect(ids(key('Escape'), card)).toEqual([])
  })

  it('moves, opens and scrolls on the arrows and the scrollport; in Overview, Enter on an arrow zooms to it', () => {
    const arrow = { ...card, on: 'arrow' as const, messageId: 'm1' }
    expect(ids(key('ArrowDown'), arrow)).toEqual(['move'])
    expect(ids(key('ArrowUp'), { ...card, on: 'scrollport' })).toEqual(['move'])
    expect(ids(key('Enter'), arrow)).toEqual(['open'])
    expect(ids(key(' '), arrow)).toEqual(['open'])
    expect(ids(key('Enter'), { ...arrow, overview: true })).toEqual(['zoom-to-message'])
    expect(ids(key(' '), { ...arrow, overview: true })).toEqual(['open'])
    expect(ids(key('Enter'), { ...card, on: 'scrollport', overview: true })).toEqual(['open'])
    expect(ids(key('ArrowRight', { shiftKey: true }), arrow)).toEqual(['scroll-sideways'])
    expect(ids(key('Home'), { ...card, on: 'scrollport' })).toEqual(['scroll-sideways'])
    expect(ids(key('Home', { shiftKey: true }), arrow)).toEqual([])
    expect(ids(key('ArrowDown'), card)).toEqual([])
  })

  it('steps Find with Enter, Shift+Enter, F3 and Ctrl or Cmd+G in the Find box, and opens a link with Enter or Space', () => {
    const find = { ...card, on: 'find' as const }
    for (const e of [key('Enter'), key('Enter', { shiftKey: true }), key('F3'), key('g', { ctrlKey: true })])
      expect(ids(e, find), e.key).toEqual(['find-step'])
    expect(ids(key('a'), find)).toEqual([])
    const link = { ...card, on: 'link' as const, messageId: 'm1' }
    expect(ids(key('Enter'), link)).toEqual(['open-link'])
    expect(ids(key(' '), link)).toEqual(['open-link'])
    expect(ids(key('a'), link)).toEqual([])
  })
})

/**
 * Every key, with every mix of modifiers, in every state each scope can be in: no two bindings in
 * one scope may take the same key, or which one runs would depend on the table's order.
 */
describe('key conflicts', () => {
  const KEYS = [
    ...['/', 'j', 'k', 'd', '?', 'x', 'g', '+', '=', '-', '−', '0', '1', '!', ' '],
    ...['Enter', 'Escape', 'Tab', 'Delete', 'Backspace', 'ContextMenu', 'F3', 'F10'],
    ...['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'],
  ]
  const events = KEYS.flatMap((k) =>
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((bits) => ({
      key: k,
      code: k === '!' || k === '1' ? 'Digit1' : k === '0' ? 'Digit0' : '',
      shiftKey: Boolean(bits & 1),
      ctrlKey: Boolean(bits & 2),
      metaKey: Boolean(bits & 4),
      altKey: Boolean(bits & 8),
    })),
  )
  const flags = (n: number) =>
    [...Array(1 << n).keys()].map((bits) => [...Array(n).keys()].map((i) => Boolean(bits & (1 << i))))
  const contexts: { [S in KeyScope]: ScopeContexts[S][] } = {
    menu: [{}],
    header: [{}],
    dialog: [{ open: true }, { open: false }],
    panel: [{ open: true }, { open: false }],
    diagram: (['find', 'arrow', 'scrollport', 'link', 'card'] as const).flatMap((on) =>
      flags(4).map(([zoomable, overview, panelOpen, singleKeys]) => ({
        on,
        zoomable,
        overview,
        panelOpen,
        singleKeys,
        messageId: on === 'arrow' || on === 'link' ? 'm1' : null,
        scrollport: null,
        target: null as unknown as HTMLElement,
      })),
    ),
    page: flags(7).map(([typing, ownKeys, arrows, onControl, inMenu, hasScenario, singleKeys]) => ({
      typing,
      ownKeys,
      arrows,
      onControl,
      inMenu,
      hasScenario,
      singleKeys,
    })),
  }

  /** The keys two or more bindings of [table] in [scope] take at once. */
  function clashes(table: readonly KeyBinding[], scope: KeyScope): string[] {
    const found = new Set<string>()
    const inScope = table.filter((b) => b.scope === scope && b.matches)
    for (const ctx of contexts[scope])
      for (const e of events) {
        const ids = inScope.filter((b) => (b.matches as (e: KeyEvent, c: unknown) => boolean)(e, ctx)).map((b) => b.id)
        if (ids.length > 1) found.add(`${ids.join(' and ')} on ${e.key}`)
      }
    return [...found]
  }

  for (const scope of KEY_SCOPES) {
    it(`gives each key at most one binding in the ${scope} scope`, () => {
      expect(KEY_BINDINGS.some((b) => b.scope === scope && b.matches)).toBe(true)
      expect(clashes(KEY_BINDINGS, scope)).toEqual([])
    })
  }

  it('fails when two bindings in one scope take the same key', () => {
    const twice: KeyBinding = { id: 'theme-again', scope: 'page', matches: (e, c) => c.singleKeys && e.key === 'd' }
    expect(clashes([...KEY_BINDINGS, twice], 'page')).toContain('theme and theme-again on d')
    const zoomTwice: KeyBinding = { id: 'zoom-again', scope: 'diagram', matches: (e) => e.key === '+' }
    expect(clashes([...KEY_BINDINGS, zoomTwice], 'diagram')).toContain('zoom-in and zoom-again on +')
  })

  it('has unique ids', () => {
    const ids = KEY_BINDINGS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('help', () => {
  it('lists every key the page handles in the help toast', () => {
    const help = keyHelpHtml()
    for (const k of ['/', 'j', 'k', '↓', '↑', 'Enter', 'd', '?', 'Esc', '+', '−', '0'])
      expect(help).toContain(`<kbd>${k}</kbd>`)
  })

  it('keeps the help toast text as it was', () => {
    expect(keyHelpHtml().replace(/\s*<br\/>\s*/g, '\n')).toBe(
      [
        '<kbd>/</kbd> search · <kbd>j</kbd>/<kbd>k</kbd> or <kbd>↓</kbd>/<kbd>↑</kbd> next/prev scenario · <kbd>Enter</kbd> go to its diagram',
        'In a diagram, <kbd>↑</kbd>/<kbd>↓</kbd> move between messages · <kbd>Enter</kbd> opens the side panel · In participant headers, <kbd>←</kbd>/<kbd>→</kbd> move between Hide and More, <kbd>Shift</kbd>+<kbd>F10</kbd> more actions',
        'In Find, <kbd>Enter</kbd>/<kbd>Shift</kbd>+<kbd>Enter</kbd> (or <kbd>F3</kbd>) next/previous match · Find also searches payloads (<b>{}</b> in the field turns that off)',
        '<kbd>d</kbd> theme (Auto follows the OS, light, dark, high contrast) · <kbd>?</kbd> help · <kbd>Esc</kbd> close',
        'In a diagram, <kbd>+</kbd>/<kbd>−</kbd> zoom, <kbd>0</kbd> default zoom, <kbd>Shift</kbd>+<kbd>1</kbd> overview (<kbd>Esc</kbd> leaves it) · In a wide diagram, <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> scroll a screen sideways, <kbd>Home</kbd>/<kbd>End</kbd> go to its edges',
        'On the Sequence and Components tabs, <kbd>←</kbd>/<kbd>→</kbd> move between them, <kbd>Enter</kbd> shows that view',
      ].join('\n'),
    )
  })

  it('draws the single-keys label from the table, as it was', () => {
    expect(singleKeysLabelHtml()).toBe(
      'Single-key shortcuts (<kbd>/</kbd> <kbd>j</kbd> <kbd>k</kbd> <kbd>d</kbd> <kbd>?</kbd>, and <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> <kbd>Shift</kbd>+<kbd>1</kbd> in a diagram)',
    )
  })
})
