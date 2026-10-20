// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { KEY_BINDINGS, ROUTED_SCOPES } from './bindings'
import { createKeyRouter, type KeyContexts } from './router'

const page = {
  typing: false,
  ownKeys: false,
  arrows: true,
  onControl: false,
  hasScenario: true,
  singleKeys: true,
  helpOpen: true,
}
const keydown = (key: string) => new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })

describe('key router', () => {
  it('runs the innermost scope first, and one handler only', () => {
    const ctx: KeyContexts = { panel: { open: true }, diagram: null, page }
    const router = createKeyRouter(() => ctx)
    const panel = vi.fn()
    const help = vi.fn()
    router.on('panel', 'close-panel', panel)
    router.on('page', 'close-help', help)
    const e = keydown('Escape')
    expect(router.dispatch(e)).toBe(true)
    expect(e.defaultPrevented).toBe(true)
    expect(panel).toHaveBeenCalledOnce()
    expect(help).not.toHaveBeenCalled()
    ctx.panel = { open: false }
    router.dispatch(keydown('Escape'))
    expect(help).toHaveBeenCalledOnce()
  })

  it('goes on to the next scope when a handler returns false, and leaves a key nobody used', () => {
    const router = createKeyRouter(() => ({ panel: { open: true }, diagram: null, page }))
    router.on('panel', 'close-panel', () => false)
    const help = vi.fn()
    router.on('page', 'close-help', help)
    expect(router.dispatch(keydown('Escape'))).toBe(true)
    expect(help).toHaveBeenCalledOnce()
    const x = keydown('x')
    expect(router.dispatch(x)).toBe(false)
    expect(x.defaultPrevented).toBe(false)
  })

  it('leaves a key a widget has already used', () => {
    const router = createKeyRouter(() => ({ panel: { open: true }, diagram: null, page }))
    const panel = vi.fn()
    router.on('panel', 'close-panel', panel)
    const e = keydown('Escape')
    e.preventDefault()
    expect(router.dispatch(e)).toBe(false)
    expect(panel).not.toHaveBeenCalled()
  })

  it('takes handlers only for bindings with keys in the scope named, once each, and lists the rest', () => {
    const router = createKeyRouter(() => ({ panel: null, diagram: null, page: null }))
    expect(() => router.on('page', 'nope', () => {})).toThrow('no key binding nope')
    expect(() => router.on('page', 'close-panel', () => {})).toThrow('in panel, not page')
    expect(() => router.on('diagram', 'find-payloads', () => {})).toThrow('help note')
    router.on('page', 'search', () => {})
    expect(() => router.on('page', 'search', () => {})).toThrow('already has a handler')
    const routed = KEY_BINDINGS.filter((b) => ROUTED_SCOPES.includes(b.scope as never) && b.matches)
    expect(router.unhandled()).toHaveLength(routed.length - 1)
    expect(router.unhandled()).not.toContain('search')
  })

  it('listens on the document', () => {
    const router = createKeyRouter(() => ({ panel: { open: true }, diagram: null, page }))
    const panel = vi.fn()
    router.on('panel', 'close-panel', panel)
    router.listen(document)
    document.body.dispatchEvent(keydown('Escape'))
    expect(panel).toHaveBeenCalledOnce()
  })
})
