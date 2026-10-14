// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LayoutRow } from '../layout'
import type { DiagramEvent } from '../../types'
import { extentOnScreen, firstSearchHit, revealSearchHit, rowExtent, updateSearchCurrent } from './search-reveal'
import { diagramState, diagramView, type MountedDiagram } from './state'

function row(event: DiagramEvent, y: number, height = 40): LayoutRow {
  return { index: 0, y, height, event }
}
const rows: LayoutRow[] = [
  row({ kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'place order', type: 'SYNCHRONOUS' }, 40),
  row({ kind: 'note', id: 'n1', text: 'order is queued', over: 'b', placement: 'over' }, 120, 60),
  row({ kind: 'message', id: 'm2', from: 'b', to: 'c', label: 'charge order', type: 'SYNCHRONOUS' }, 2000),
]

/** A scrollport of [height] px at [top] on screen, sticking at 56px, with a 50px participant header. */
function mount(top: number, height = 600, sticky = 'sticky') {
  document.body.innerHTML = `<div class="seq-stage"><div class="seq-scroll" data-scenario-id="s" style="position: ${sticky}; top: 56px">
    <div class="seq-sticky-header"></div></div></div>`
  const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
  const header = document.querySelector<HTMLElement>('.seq-sticky-header')!
  Object.defineProperty(header, 'offsetHeight', { value: 50, configurable: true })
  Object.defineProperty(scroll, 'clientHeight', { value: height, configurable: true })
  Object.defineProperty(scroll, 'scrollHeight', { value: 3000, configurable: true })
  scroll.getBoundingClientRect = () => ({ top, height }) as DOMRect
  scroll.closest<HTMLElement>('.seq-stage')!.getBoundingClientRect = () => ({ top }) as DOMRect
  diagramState.mounted.set('s', { rows } as unknown as MountedDiagram)
  return scroll
}

afterEach(() => {
  diagramState.mounted.clear()
  diagramState.views.clear()
  vi.restoreAllMocks()
})

describe('find: the current match', () => {
  it('is the first matching row in drawing order, skipping rows on hidden columns', () => {
    expect(firstSearchHit(rows, 'order', new Set())?.event.id).toBe('m1')
    expect(firstSearchHit(rows, 'order', new Set(['a']))?.event.id).toBe('n1')
    expect(firstSearchHit(rows, 'QUEUED', new Set())?.event.id).toBe('n1')
    expect(firstSearchHit(rows, '  ', new Set())).toBeNull()
    expect(firstSearchHit(rows, 'refund', new Set())).toBeNull()
  })

  it('covers a label above its arrow, and a note card centred on its row', () => {
    expect(rowExtent(rows[0])).toEqual({ top: 20, bottom: 48 })
    expect(rowExtent(rows[1])).toEqual({ top: 90, bottom: 150 })
  })

  it('is stored on the view from its query', () => {
    mount(100)
    diagramView('s').query = 'charge'
    expect(updateSearchCurrent('s')?.event.id).toBe('m2')
    expect(diagramView('s').searchCurrentId).toBe('m2')
    diagramView('s').query = ''
    expect(updateSearchCurrent('s')).toBeNull()
    expect(diagramView('s').searchCurrentId).toBeNull()
  })
})

describe('find: on screen', () => {
  it('counts what is below the sticky header and above the bottom of the visual viewport (keyboard)', () => {
    const scroll = mount(56)
    expect(extentOnScreen(scroll, 20, 48)).toBe(true)
    expect(extentOnScreen(scroll, -10, 10)).toBe(false)
    Object.defineProperty(window, 'visualViewport', { value: { offsetTop: 0, height: 300 }, configurable: true })
    expect(extentOnScreen(scroll, 100, 150)).toBe(true)
    expect(extentOnScreen(scroll, 200, 240)).toBe(false)
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
  })

  it('moves the page to a match that is off screen, at the current zoom', () => {
    const scroll = mount(56)
    diagramView('s').query = 'charge'
    diagramView('s').zoom = 0.5
    updateSearchCurrent('s')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    expect(revealSearchHit(scroll)).toBe(true)
    // Label top 1980 px at 50% = 990, less the 8 px margin; the stage top is at the sticky top.
    expect(scrollTo).toHaveBeenCalledWith({ top: window.scrollY + 56 - 56 + 982, behavior: 'instant' })
  })

  it('leaves the page alone when the match is already on screen, and does nothing without one', () => {
    const scroll = mount(56)
    diagramView('s').query = 'place'
    updateSearchCurrent('s')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    expect(revealSearchHit(scroll)).toBe(true)
    expect(scrollTo).not.toHaveBeenCalled()
    diagramView('s').query = 'refund'
    updateSearchCurrent('s')
    expect(revealSearchHit(scroll)).toBe(false)
  })
})
