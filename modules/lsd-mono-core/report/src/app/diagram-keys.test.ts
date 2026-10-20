// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagramKeyContext } from '../lib/keys/bindings'

const seq = vi.hoisted(() => ({
  diagramView: vi.fn(() => ({ hidden: new Set<string>(), activeMessageId: null as string | null })),
  findMessage: vi.fn((_s: unknown, id: string) => ({ id })),
  focusDiagramMessage: vi.fn(),
  stepFind: vi.fn(),
}))
const panel = vi.hoisted(() => ({ openMessage: vi.fn(), scenarioFrom: vi.fn() }))
const media = vi.hoisted(() => ({ isCoarsePointer: vi.fn(() => false) }))
const ctx = vi.hoisted(() => ({ session: { inspector: { isOpen: vi.fn(() => false) } } }))
vi.mock('../lib/sequence-diagram', () => seq)
vi.mock('./panel', () => panel)
vi.mock('../lib/media', () => media)
vi.mock('./context', () => ctx)

const { registerDiagramKeys } = await import('./diagram-keys')
const { createKeyRouter } = await import('../lib/keys/router')

const scenario = {
  id: 's1',
  events: [
    { kind: 'message', id: 'm1', from: 'a', to: 'b', payloadId: 'p' },
    { kind: 'message', id: 'm2', from: 'a', to: 'b', payloadId: 'p' },
  ],
}
let diagram: DiagramKeyContext
const router = createKeyRouter(() => ({ panel: null, page: null, diagram }))
registerDiagramKeys(router)
const press = (key: string, init: KeyboardEventInit = {}) =>
  router.dispatch(new KeyboardEvent('keydown', { key, cancelable: true, ...init }))

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = `<div id="card-s1"><input id="find"><div class="seq-scroll"></div></div>`
  const scrollport = document.querySelector<HTMLElement>('.seq-scroll')!
  Object.defineProperties(scrollport, {
    clientWidth: { value: 400, configurable: true },
    scrollWidth: { value: 1200, configurable: true },
  })
  panel.scenarioFrom.mockReturnValue(scenario)
  diagram = {
    on: 'arrow',
    zoomable: true,
    overview: false,
    panelOpen: false,
    singleKeys: true,
    messageId: 'm1',
    scrollport,
    target: scrollport,
  }
})

describe('diagram keys', () => {
  it('steps Find forwards and back, and closes a soft keyboard on Enter', () => {
    const find = document.querySelector<HTMLInputElement>('#find')!
    diagram = { ...diagram, on: 'find', target: find }
    expect(press('Enter')).toBe(true)
    expect(press('Enter', { shiftKey: true })).toBe(true)
    expect(seq.stepFind.mock.calls.map((c: unknown[]) => c[1] as number)).toEqual([1, -1])
    media.isCoarsePointer.mockReturnValue(true)
    find.focus()
    press('Enter')
    expect(document.activeElement).not.toBe(find)
    diagram = { ...diagram, scrollport: null }
    expect(press('Enter')).toBe(false)
  })

  it('scrolls sideways a screen at a time, and lets the key go when there is nowhere to scroll', () => {
    expect(press('ArrowRight', { shiftKey: true })).toBe(true)
    expect(diagram.scrollport!.scrollLeft).toBe(352)
    expect(press('Home')).toBe(true)
    expect(diagram.scrollport!.scrollLeft).toBe(0)
    expect(press('Home')).toBe(false)
  })

  it('moves along the arrows, and the open side panel follows', () => {
    expect(press('ArrowDown')).toBe(true)
    expect(seq.focusDiagramMessage).toHaveBeenCalledWith(diagram.scrollport, 'm2')
    expect(panel.openMessage).not.toHaveBeenCalled()
    ctx.session.inspector.isOpen.mockReturnValue(true)
    press('ArrowDown')
    expect(panel.openMessage).toHaveBeenCalledWith(scenario, { id: 'm2' })
  })

  it('opens the focused arrow, or the first from the scrollport, and an arrow drawn as a link', () => {
    expect(press('Enter')).toBe(true)
    expect(panel.openMessage).toHaveBeenLastCalledWith(scenario, { id: 'm1' })
    diagram = { ...diagram, on: 'scrollport', messageId: null }
    press(' ')
    expect(panel.openMessage).toHaveBeenLastCalledWith(scenario, { id: 'm1' })
    diagram = { ...diagram, on: 'link', messageId: 'm2' }
    expect(press('Enter')).toBe(true)
    expect(panel.openMessage).toHaveBeenLastCalledWith(scenario, { id: 'm2' })
  })

  it('lets the key go outside a known scenario', () => {
    panel.scenarioFrom.mockReturnValue(undefined)
    expect(press('ArrowDown')).toBe(false)
    expect(press('Enter')).toBe(false)
  })
})
