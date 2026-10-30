// @vitest-environment happy-dom
// One frame drawn per zoom change (#100): the fit's trial scales only resize, and every change
// ends with the header drawn (or resized in place) for the final zoom.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Participant, Scenario } from '../../types'
import { bindDiagramScroll, diagramView, renderDiagramHtml } from '../sequence-diagram'
import { frameOf } from './geometry'
import { headActionKey, headerHtml, resizeHeader } from './rows'
import { diagramState } from './state'
import { applyDiagramFrame } from './window'
import { refitDiagram } from './zoom'
import { WHEEL_STEP_PX, zoomByWheel } from './zoom-controls'
import { flushDiagramPaints } from './invalidate'
import { untimed } from '../report-fixture.test-util'
import { DEFAULT_LABEL_MAX_CHARS } from '../../ui/format'

// applyDiagramFrame is the only code that sets --seq-print-max, once a call: counting those sets
// counts the frames drawn, however the header was brought up to date (in place since #101).
// Each pass of settleFitWidth's callback is one trial scale.
const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
const frames = () => setProperty.mock.calls.filter(([name]) => name === '--seq-print-max').length
vi.mock('../diagram-view', async (importOriginal) => {
  const real = await importOriginal<typeof import('../diagram-view')>()
  return {
    ...real,
    settleFitWidth: vi.fn((start: number, applyAt: (width: number) => number, maxPasses?: number) =>
      real.settleFitWidth(
        start,
        (w) => {
          trials++
          return applyAt(w)
        },
        maxPasses,
      ),
    ),
  }
})
let trials = 0

let n = 0
function scenario(lanes: number, messages = lanes - 1): Scenario {
  n++
  const participants: Participant[] = Array.from({ length: lanes }, (_, i) => ({
    id: `p${i}`,
    name: `Service ${i}`,
    type: 'participant',
  }))
  return {
    ...untimed(),
    id: `frame-count-${n}`,
    title: 'Frame count',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants,
    events: Array.from({ length: messages }, (_, i) => ({
      kind: 'message' as const,
      id: `m${i}`,
      from: 'p0',
      to: `p${(i % (lanes - 1)) + 1}`,
      label: `call ${i}`,
      type: 'synchronous' as const,
    })),
  }
}

type Counts = { applied: number; trials: number }

/**
 * Render a diagram in a scrollport [width] px wide (a getter, so a test can change it), and bind
 * it unless [bind] is false. With [scrollbar], the drawing growing taller than the scrollport
 * takes 15px of the width, as a classic scrollbar does, so a fit settles over more than one trial.
 */
function mount(lanes: number, width: number, { messages = lanes - 1, scrollbar = false, bind = true } = {}) {
  const s = scenario(lanes, messages)
  const host = document.createElement('div')
  let panel = width
  const render = () => {
    host.innerHTML = renderDiagramHtml(s, DEFAULT_LABEL_MAX_CHARS)
    const scroll = host.querySelector<HTMLElement>('.seq-scroll')!
    const spacer = scroll.querySelector<HTMLElement>('.seq-spacer')!
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(scroll, 'clientWidth', {
      configurable: true,
      get: () => (scrollbar && parseFloat(spacer.style.height || '0') > 600 ? panel - 15 : panel),
    })
  }
  render()
  document.body.append(host)
  if (bind) bindDiagramScroll(host)
  const scroll = () => host.querySelector<HTMLElement>('.seq-scroll')!
  const root = () => host.querySelector<HTMLElement>('.seq-diagram')!
  const click = (zoom: string) => root().querySelector<HTMLButtonElement>(`[data-zoom="${zoom}"]`)!.click()
  /**
   * Run [change], check the frame it leaves is drawn for the final zoom, and count the frames drawn
   * up to and including its repaint (#104). What was pending before is painted first.
   */
  const count = (change: () => void): Counts => {
    flushDiagramPaints()
    setProperty.mockClear()
    trials = 0
    change()
    flushDiagramPaints()
    expectRedrawn()
    return { applied: frames(), trials }
  }
  /** The header is the one applyDiagramFrame draws at the current zoom and lanes, unclipped. */
  const expectRedrawn = () => {
    const view = diagramView(s.id)
    const diagram = diagramState.mounted.get(s.id)!
    const header = scroll().querySelector<HTMLElement>('.seq-sticky-header')!
    expect(header.querySelector<HTMLElement>('.participant-heads')!.style.overflow).toBe('')
    const stop = header.querySelector<HTMLElement>('.participant-heads button[tabindex="0"]')
    const fresh = document.createElement('div')
    fresh.innerHTML = headerHtml(
      s,
      frameOf(diagram, view.hidden),
      view.hidden,
      view.zoom,
      stop ? headActionKey(stop) : null,
    )
    expect(header.innerHTML).toBe(fresh.innerHTML)
    const spacer = scroll().querySelector<HTMLElement>('.seq-spacer')!
    expect(parseFloat(spacer.style.width)).toBeCloseTo(frameOf(diagram, view.hidden).total * view.zoom, 3)
  }
  const lane = (id: string) => {
    const head = scroll().querySelector(`[data-participant-head="${id}"]`)!
    head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    head.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    return root()
  }
  return {
    s,
    host,
    render,
    scroll,
    click,
    count,
    view: () => diagramView(s.id),
    setWidth: (next: number) => (panel = next),
    hide: (id: string) => lane(id).querySelector<HTMLButtonElement>(`[data-hide-participant="${id}"]`)!.click(),
    showAll: () => root().querySelector<HTMLButtonElement>('[data-show-all]')!.click(),
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('one frame per zoom change (#100)', () => {
  it('a step in or out, by button or wheel', () => {
    const z = mount(12, 600)
    expect(z.count(() => z.click('in')).applied).toBe(1)
    expect(z.count(() => z.click('out')).applied).toBe(1)
    expect(z.count(() => zoomByWheel(z.scroll(), WHEEL_STEP_PX, 0, 1)).applied).toBe(1)
  })

  it('reset to the default view, from a zoom of the user’s own', () => {
    const z = mount(12, 600)
    z.click('in')
    z.click('in')
    expect(z.count(() => z.click('reset')).applied).toBe(1)
    expect(z.view().mode.kind).toBe('default')
  })

  it('Overview on, and off again', () => {
    const z = mount(12, 600)
    expect(z.count(() => z.click('overview')).applied).toBe(1)
    expect(z.view().mode.kind).toBe('overview')
    expect(z.count(() => z.click('overview')).applied).toBe(1)
    expect(z.view().mode.kind).toBe('default')
  })

  it('Overview off after the panel changed width: the return, then the refit', () => {
    const z = mount(12, 600)
    z.click('overview')
    z.setWidth(1400)
    expect(z.count(() => z.click('overview'))).toMatchObject({ applied: 2 })
    expect(z.view().mode).toEqual({ kind: 'default', fittedWidth: 1400 })
  })

  it('still once when the fit settles over several trial scales, which only resize', () => {
    // Tall at the default view (a scrollbar), short in Overview (none): each way, the first trial
    // scale changes the width there is, and the fit tries again.
    const z = mount(30, 1000, { messages: 45, scrollbar: true })
    const spacerH = () => parseFloat(z.scroll().querySelector<HTMLElement>('.seq-spacer')!.style.height)
    expect(spacerH()).toBeGreaterThan(600)
    const overview = z.count(() => z.click('overview'))
    expect(spacerH()).toBeLessThanOrEqual(600)
    expect(overview.applied).toBe(1)
    expect(overview.trials).toBeGreaterThan(1)
    const reset = z.count(() => z.click('reset'))
    expect(spacerH()).toBeGreaterThan(600)
    expect(reset.applied).toBe(1)
    expect(reset.trials).toBeGreaterThan(1)
  })

  it('first mount: fitted, and drawn once', () => {
    const z = mount(12, 600, { bind: false })
    const counts = z.count(() => bindDiagramScroll(z.host))
    expect(counts.applied).toBe(1)
    expect(counts.trials).toBeGreaterThan(0)
    expect(z.view().mode).toEqual({ kind: 'default', fittedWidth: 600 })
  })

  it('mount with nothing to fit (a collapsed card), and a re-render while zoomed', () => {
    const collapsed = mount(12, 0, { bind: false })
    expect(collapsed.count(() => bindDiagramScroll(collapsed.host))).toEqual({ applied: 1, trials: 0 })
    const z = mount(12, 600)
    z.click('in')
    z.render()
    expect(z.count(() => bindDiagramScroll(z.host))).toEqual({ applied: 1, trials: 0 })
  })

  it('a refit when the window or panel changes width', () => {
    const z = mount(12, 600)
    z.setWidth(900)
    const counts = z.count(() => refitDiagram(z.scroll()))
    expect(counts.applied).toBe(1)
    expect(counts.trials).toBeGreaterThan(0)
    expect(z.view().mode).toEqual({ kind: 'default', fittedWidth: 900 })
    // The same width again is no change.
    expect(z.count(() => refitDiagram(z.scroll()))).toEqual({ applied: 0, trials: 0 })
  })

  it('a lane hidden, and all shown again, in the default view', () => {
    const z = mount(12, 600)
    const hide = z.count(() => z.hide('p5'))
    expect(hide.applied).toBe(1)
    expect(hide.trials).toBeGreaterThan(0)
    expect(z.view().hidden.has('p5')).toBe(true)
    expect(z.count(() => z.showAll()).applied).toBe(1)
    expect(z.view().hidden.size).toBe(0)
  })

  it('a lane hidden in Overview, or while zoomed', () => {
    const z = mount(100, 600)
    z.click('overview')
    expect(z.count(() => z.hide('p5')).applied).toBe(1)
    z.click('in')
    expect(z.count(() => z.hide('p6'))).toEqual({ applied: 1, trials: 0 })
  })
})

describe('the header across lane changes (#101)', () => {
  it('is drawn afresh, not resized in place, when as many lanes show but different ones', () => {
    const z = mount(4, 1200)
    const header = z.scroll().querySelector<HTMLElement>('.seq-sticky-header')!
    const diagram = diagramState.mounted.get(z.s.id)!
    z.view().hidden.add('p3')
    applyDiagramFrame(z.scroll())
    const zoom = z.view().zoom
    // p0 p1 p2 drawn; p0 p2 p3 asked for: the same count, so only the ids tell them apart.
    const swapped = new Set(['p1'])
    expect(resizeHeader(header, z.s, frameOf(diagram, swapped), swapped, zoom)).toBe(false)
    expect(resizeHeader(header, z.s, frameOf(diagram, z.view().hidden), z.view().hidden, zoom)).toBe(true)
  })

  it('keeps the row’s tab stop on the same button when a lane change draws the header afresh', () => {
    const z = mount(4, 1200)
    const row = () => z.scroll().querySelector<HTMLElement>('.participant-heads')!
    const stop = () => headActionKey(row().querySelector<HTMLElement>('button[tabindex="0"]')!)
    // The row's one set of actions, with the tab stop, on p2's More.
    const header = z.scroll().querySelector<HTMLElement>('.seq-sticky-header')!
    const diagram = diagramState.mounted.get(z.s.id)!
    header.innerHTML = headerHtml(z.s, frameOf(diagram, z.view().hidden), z.view().hidden, z.view().zoom, 'more:p2')
    expect(stop()).toBe('more:p2')
    const before = row()
    z.view().hidden.add('p3')
    applyDiagramFrame(z.scroll())
    expect(row()).not.toBe(before)
    expect(stop()).toBe('more:p2')
  })
})
