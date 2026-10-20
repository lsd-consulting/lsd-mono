import { describe, expect, it } from 'vitest'
import { KEY_BINDINGS, keyHelpHtml, pageAction, type KeyContext } from './key-bindings'

const page: KeyContext = { arrows: true, onControl: false, hasScenario: true, singleKeys: true }
const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}) => ({
  key: k,
  metaKey: mods.metaKey ?? false,
  ctrlKey: mods.ctrlKey ?? false,
})

describe('page key bindings', () => {
  it('maps each page key to its action', () => {
    expect(pageAction(key('/'), page)).toBe('search')
    expect(pageAction(key('k', { metaKey: true }), page)).toBe('search')
    expect(pageAction(key('k', { ctrlKey: true }), page)).toBe('search')
    expect(pageAction(key('j'), page)).toBe('next')
    expect(pageAction(key('k'), page)).toBe('prev')
    expect(pageAction(key('ArrowDown'), page)).toBe('next')
    expect(pageAction(key('ArrowUp'), page)).toBe('prev')
    expect(pageAction(key('Enter'), page)).toBe('diagram')
    expect(pageAction(key('d'), page)).toBe('theme')
    expect(pageAction(key('?'), page)).toBe('help')
    expect(pageAction(key('Escape'), page)).toBe('close')
    expect(pageAction(key('x'), page)).toBeNull()
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
    expect(pageAction(key('Escape'), off)).toBe('close')
  })

  it('does not take j, d or / with Ctrl, Cmd or Alt held, so browser shortcuts stay theirs', () => {
    for (const k of ['/', 'j', 'd', '?']) {
      expect(pageAction(key(k, { ctrlKey: true }), page), `ctrl ${k}`).toBeNull()
      expect(pageAction(key(k, { metaKey: true }), page), `cmd ${k}`).toBeNull()
      expect(pageAction({ ...key(k), altKey: true }, page), `alt ${k}`).toBeNull()
    }
  })

  it('lists every key the page handles in the help toast', () => {
    const help = keyHelpHtml()
    for (const k of ['/', 'j', 'k', '↓', '↑', 'Enter', 'd', '?', 'Esc']) expect(help).toContain(`<kbd>${k}</kbd>`)
    for (const b of KEY_BINDINGS) if (b.action) expect(b.matches).toBeTypeOf('function')
  })

  it('keeps the help toast text as it was', () => {
    expect(keyHelpHtml().replace(/\s*<br\/>\s*/g, '\n')).toBe(
      [
        '<kbd>/</kbd> search · <kbd>j</kbd>/<kbd>k</kbd> or <kbd>↓</kbd>/<kbd>↑</kbd> next/prev scenario · <kbd>Enter</kbd> go to its diagram',
        'In a diagram, <kbd>↑</kbd>/<kbd>↓</kbd> move between messages · <kbd>Enter</kbd> opens the side panel · In participant headers, <kbd>←</kbd>/<kbd>→</kbd> move between Hide and More, <kbd>Shift</kbd>+<kbd>F10</kbd> more actions',
        'In Find, <kbd>Enter</kbd>/<kbd>Shift</kbd>+<kbd>Enter</kbd> (or <kbd>F3</kbd>) next/previous match · Find also searches payloads (<b>{}</b> in the field turns that off)',
        '<kbd>d</kbd> theme (Auto follows the OS, light, dark, high contrast) · <kbd>?</kbd> help · <kbd>Esc</kbd> close',
        'In a diagram, <kbd>+</kbd>/<kbd>−</kbd> zoom, <kbd>0</kbd> default zoom, <kbd>Shift</kbd>+<kbd>1</kbd> overview (<kbd>Esc</kbd> leaves it) · In a wide diagram, <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> scroll a screen sideways, <kbd>Home</kbd>/<kbd>End</kbd> go to its edges',
      ].join('\n'),
    )
  })
})
