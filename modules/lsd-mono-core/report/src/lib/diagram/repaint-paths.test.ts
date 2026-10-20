// @vitest-environment happy-dom
// Each path that changes the diagram and asks for a repaint (#104) gets that repaint: Find's
// Next, a zoom step with no scroll event, a refit, the reveal once typing pauses, a lane hidden
// under Find matches, the width observer's refit, and printing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Participant, Scenario } from '../../types'
import { bindDiagramScroll, diagramView, renderDiagramHtml, setFindHooks } from '../sequence-diagram'
import { frameOf } from './geometry'
import { flushDiagramPaints } from './invalidate'
import { setPayloadLoader, setPayloadSlicer } from './payload-find'
import { SEARCH_REVEAL_DELAY_MS } from './search-reveal'
import { diagramState, forgetDiagrams } from './state'
import { refitDiagram } from './zoom'

let n = 0
function scenario(messages: number): Scenario {
  n++
  const participants: Participant[] = ['p0', 'p1', 'p2', 'p3'].map((id, i) => ({
    id,
    name: `Service ${i}`,
    type: 'PARTICIPANT',
  }))
  return {
    id: `repaint-${n}`,
    title: 'Repaint',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants,
    events: Array.from({ length: messages }, (_, i) => ({
      kind: 'message' as const,
      id: `m${i}`,
      from: 'p0',
      to: i === messages - 1 ? 'p3' : `p${(i % 2) + 1}`,
      // The last message is the only "needle", far down the diagram and on p3's lane.
      label: i === messages - 1 ? 'needle' : `call ${i % 2 === 0 ? 'even' : 'odd'}`,
      type: 'SYNCHRONOUS' as const,
      // A payload makes each arrow a button, so the painted rows can be read by message.
      payloadId: `repaint-${n}/m${i}`,
    })),
  }
}

function mount(messages = 6, width = 1400) {
  const s = scenario(messages)
  const host = document.createElement('div')
  host.innerHTML = renderDiagramHtml(s)
  document.body.append(host)
  let panel = width
  const scroll = host.querySelector<HTMLElement>('.seq-scroll')!
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 300 })
  Object.defineProperty(scroll, 'clientWidth', { configurable: true, get: () => panel })
  bindDiagramScroll(host)
  flushDiagramPaints()
  const find = host.querySelector<HTMLInputElement>('[data-diagram-find]')!
  return {
    s,
    host,
    scroll,
    view: () => diagramView(s.id),
    setWidth: (next: number) => (panel = next),
    count: () => host.querySelector('.diagram-find-count')!.textContent,
    type: (value: string) => {
      find.value = value
      find.dispatchEvent(new Event('input', { bubbles: true }))
    },
    /** The painted rows' drawn width, and the width they should have at the current zoom. */
    rowsWidth: () => ({
      painted: Number(scroll.querySelector('.seq-window .seq-svg')!.getAttribute('width')),
      wanted: frameOf(diagramState.mounted.get(s.id)!, diagramView(s.id).hidden).total * diagramView(s.id).zoom,
    }),
    current: () =>
      scroll.querySelector('.msg-open[aria-label*="current search match"]')?.getAttribute('data-message-id'),
  }
}

beforeEach(() => {
  forgetDiagrams()
  diagramState.widthObserver = null
  diagramState.observedScrollports.clear()
  setPayloadSlicer({ now: () => 0, later: (resume) => resume(), budgetMs: 8 })
  setPayloadLoader(() => Promise.resolve({}))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  setPayloadSlicer(null)
  setFindHooks({})
})

describe('the diagram repaints after each kind of change (#104)', () => {
  it('Next in Find moves the current mark and the count', () => {
    const z = mount()
    z.type('even')
    flushDiagramPaints()
    expect(z.count()).toMatch(/^1 of 3/)
    expect(z.current()).toBe('m0')
    z.host.querySelector<HTMLButtonElement>('[data-find-step="next"]')!.click()
    flushDiagramPaints()
    expect(z.count()).toMatch(/^2 of 3/)
    expect(z.current()).toBe('m2')
  })

  it('a zoom step at the top left, with no scroll event, repaints the rows at the new zoom', () => {
    const z = mount()
    const before = z.rowsWidth()
    expect(before.painted).toBeCloseTo(before.wanted, 3)
    z.host.querySelector<HTMLButtonElement>('[data-zoom="out"]')!.click()
    flushDiagramPaints()
    const after = z.rowsWidth()
    expect(after.wanted).not.toBeCloseTo(before.wanted, 3)
    expect(after.painted).toBeCloseTo(after.wanted, 3)
  })

  it('a refit to a narrower width repaints the rows at the fitted zoom', () => {
    const z = mount(6, 1400)
    const before = z.rowsWidth()
    z.setWidth(500)
    refitDiagram(z.scroll)
    flushDiagramPaints()
    const after = z.rowsWidth()
    expect(after.wanted).toBeLessThan(before.wanted)
    expect(after.painted).toBeCloseTo(after.wanted, 3)
  })

  it('once typing pauses, the first match far down is brought on screen and painted', () => {
    vi.useFakeTimers()
    const z = mount(60)
    z.type('needle')
    flushDiagramPaints()
    expect(z.scroll.querySelector('.msg-open[data-message-id="m59"]')).toBeNull()
    vi.advanceTimersByTime(SEARCH_REVEAL_DELAY_MS)
    flushDiagramPaints()
    expect(z.scroll.scrollTop).toBeGreaterThan(0)
    expect(z.scroll.querySelector('.msg-open[data-message-id="m59"]')).not.toBeNull()
  })

  it('hiding the lane a Find match is on updates the count', () => {
    const z = mount()
    z.type('needle')
    flushDiagramPaints()
    expect(z.count()).not.toContain('hidden column')
    const head = z.scroll.querySelector('[data-participant-head="p3"]')!
    head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    head.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    z.host.querySelector<HTMLButtonElement>('[data-hide-participant="p3"]')!.click()
    flushDiagramPaints()
    expect(z.count()).toContain('1 on a hidden column')
  })

  it('the width observer paints its refit itself, before the frame it runs in is drawn', () => {
    const callbacks: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    const z = mount(6, 1400)
    const before = z.rowsWidth()
    z.setWidth(500)
    // What the browser does after this frame's animation callbacks: no flush follows.
    callbacks[0]([{ target: z.scroll } as unknown as ResizeObserverEntry], {} as ResizeObserver)
    const after = z.rowsWidth()
    expect(after.wanted).toBeLessThan(before.wanted)
    expect(after.painted).toBeCloseTo(after.wanted, 3)
  })

  it('printing paints what is pending first: a Find count typed just before', () => {
    const z = mount()
    z.type('even')
    flushDiagramPaints()
    z.type('odd')
    expect(z.count()).toMatch(/^1 of 3/)
    window.dispatchEvent(new Event('beforeprint'))
    expect(z.count()).toMatch(/^1 of 2/)
    window.dispatchEvent(new Event('afterprint'))
  })
})
