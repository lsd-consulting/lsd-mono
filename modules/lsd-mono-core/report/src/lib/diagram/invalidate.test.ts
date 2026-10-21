// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scenario } from '../../types'
import { bindDiagramScroll, renderDiagramHtml, setFindHooks, syncDiagramWindow } from '../sequence-diagram'
import { createInvalidator, flushDiagramPaints, type DiagramPainters } from './invalidate'
import { setPayloadLoader, setPayloadSlicer } from './payload-find'
import { forgetDiagrams } from './state'
import { untimed } from '../report-fixture.test-util'

function fakePainters() {
  const calls: string[] = []
  const scrollports = new Map<string, HTMLElement>([
    ['a', document.createElement('div')],
    ['b', document.createElement('div')],
  ])
  const paint: DiagramPainters = {
    scrollport: (id) => scrollports.get(id) ?? null,
    frame: (_s, id) => calls.push(`frame ${id}`),
    window: (_s, id) => calls.push(`window ${id}`),
    find: (_s, id) => calls.push(`find ${id}`),
    hooks: (_s, id) => calls.push(`hooks ${id}`),
  }
  return { calls, paint }
}

describe('createInvalidator', () => {
  it('paints once per frame, however many changes asked, in the order frame, window, Find, hooks', () => {
    const { calls, paint } = fakePainters()
    const frames: (() => void)[] = []
    const diagrams = createInvalidator(paint, (run) => frames.push(run))
    diagrams.invalidate('a', ['window'])
    diagrams.invalidate('a', ['hooks', 'find', 'window'])
    diagrams.invalidate('a', ['frame'])
    diagrams.invalidate('b', ['window'])
    expect(frames).toHaveLength(1)
    expect(calls).toEqual([])
    frames[0]()
    expect(calls).toEqual(['frame a', 'window a', 'find a', 'hooks a', 'window b'])
    // Nothing pending, nothing painted; the next change asks for the next frame.
    diagrams.flush()
    expect(calls).toHaveLength(5)
    diagrams.invalidate('a', ['find'])
    expect(frames).toHaveLength(2)
  })

  it('paints now on flush, and the frame that was asked for then has nothing to do', () => {
    const { calls, paint } = fakePainters()
    const frames: (() => void)[] = []
    const diagrams = createInvalidator(paint, (run) => frames.push(run))
    diagrams.invalidate('a', ['window'])
    diagrams.flush()
    expect(calls).toEqual(['window a'])
    frames[0]()
    expect(calls).toEqual(['window a'])
  })

  it('paints the other parts and diagrams when one painter throws, then rethrows its error', () => {
    const { calls, paint } = fakePainters()
    const frames: (() => void)[] = []
    paint.window = (_s, id) => {
      calls.push(`window ${id}`)
      if (id === 'a') throw new Error('window a broke')
    }
    const diagrams = createInvalidator(paint, (run) => frames.push(run))
    diagrams.invalidate('a', ['window', 'find'])
    diagrams.invalidate('b', ['window'])
    expect(() => frames[0]()).toThrow('window a broke')
    expect(calls).toEqual(['window a', 'find a', 'window b'])
  })

  it('skips a diagram that is no longer mounted, and an empty change', () => {
    const { calls, paint } = fakePainters()
    const frames: (() => void)[] = []
    const diagrams = createInvalidator(paint, (run) => frames.push(run))
    diagrams.invalidate('a', [])
    expect(frames).toHaveLength(0)
    diagrams.invalidate('gone', ['window', 'find'])
    diagrams.invalidate('b', ['find'])
    frames[0]()
    expect(calls).toEqual(['find b'])
  })
})

function scenario(): Scenario {
  return {
    ...untimed(),
    id: 'paints',
    title: 'Paints',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants: [
      { id: 'a', name: 'Client', type: 'ACTOR' },
      { id: 'b', name: 'Api', type: 'PARTICIPANT' },
    ],
    events: [
      {
        kind: 'message',
        id: 'm1',
        from: 'a',
        to: 'b',
        label: 'place order',
        type: 'SYNCHRONOUS',
        payloadId: 'paints/m1',
      },
      { kind: 'message', id: 'm2', from: 'b', to: 'a', label: 'order placed', type: 'SYNCHRONOUS_RESPONSE' },
    ],
  }
}

describe('the diagram paints once for several changes in one task (#104)', () => {
  beforeEach(() => {
    forgetDiagrams()
    setPayloadSlicer({ now: () => 0, later: (resume) => resume(), budgetMs: 8 })
    setPayloadLoader(() => Promise.resolve({ 'paints/m1': { order: 1 } }))
  })
  afterEach(() => {
    document.body.innerHTML = ''
    setPayloadSlicer(null)
    setFindHooks({})
  })

  it('Find typed into, payloads toggled and a zoom step: one paint of the rows, one of the count, one hook', () => {
    const changed = vi.fn()
    setFindHooks({ changed })
    const host = document.createElement('div')
    host.innerHTML = renderDiagramHtml(scenario())
    document.body.append(host)
    const scroll = host.querySelector<HTMLElement>('.seq-scroll')!
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 })
    bindDiagramScroll(host)
    syncDiagramWindow(scroll)
    flushDiagramPaints()
    changed.mockClear()

    const windowEl = scroll.querySelector<HTMLElement>('.seq-window')!
    const count = host.querySelector<HTMLElement>('.diagram-find-count')!
    const paints = { rows: 0, count: 0 }
    const watch = (el: HTMLElement, key: keyof typeof paints, prop: 'innerHTML' | 'textContent') => {
      const proto = Object.getPrototypeOf(el) as object
      let desc: PropertyDescriptor | undefined
      for (let p: object | null = proto; p && !desc; p = Object.getPrototypeOf(p) as object | null) {
        desc = Object.getOwnPropertyDescriptor(p, prop)
      }
      Object.defineProperty(el, prop, {
        configurable: true,
        get() {
          return desc!.get!.call(el) as string
        },
        set(value: string) {
          paints[key]++
          desc!.set!.call(el, value)
        },
      })
    }
    watch(windowEl, 'rows', 'innerHTML')
    watch(count, 'count', 'innerHTML')

    const find = host.querySelector<HTMLInputElement>('[data-diagram-find]')!
    find.value = 'order'
    find.dispatchEvent(new Event('input', { bubbles: true }))
    host.querySelector<HTMLButtonElement>('[data-find-payloads]')!.click()
    host.querySelector<HTMLButtonElement>('[data-zoom="in"]')!.click()
    expect(paints).toEqual({ rows: 0, count: 0 })
    expect(changed).not.toHaveBeenCalled()

    flushDiagramPaints()
    expect(paints.rows).toBe(1)
    expect(paints.count).toBe(1)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(count.textContent).toBe('1 of 2')
  })
})
