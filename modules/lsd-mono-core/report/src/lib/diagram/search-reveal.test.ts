// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LayoutRow } from '../layout'
import type { DiagramEvent } from '../../types'
import {
  extentOnScreen,
  findStepKey,
  revealSearchHit,
  rowExtent,
  scenarioSearchState,
  searchState,
  searchStateLabel,
  stepIndex,
  stepSearchCurrent,
  syncFindControls,
  updateSearchCurrent,
} from './search-reveal'
import { diagramState, diagramView, forgetDiagrams, type MountedDiagram } from './state'

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
  forgetDiagrams()
  vi.restoreAllMocks()
})

const position = () => {
  const st = scenarioSearchState('s')
  return { current: st.current + 1, count: st.hits.length }
}

describe('find: stepping through matches', () => {
  it('steps forward and back, wrapping around, and starts at an end when there is no current match', () => {
    expect([0, 1, 2].map((i) => stepIndex(3, i, 1))).toEqual([1, 2, 0])
    expect([0, 1, 2].map((i) => stepIndex(3, i, -1))).toEqual([2, 0, 1])
    expect(stepIndex(3, -1, 1)).toBe(0)
    expect(stepIndex(3, -1, -1)).toBe(2)
    expect(stepIndex(0, -1, 1)).toBe(-1)
    expect(stepIndex(1, 0, 1)).toBe(0)
  })

  it('steps on Enter, F3 and Cmd/Ctrl+G, backwards with Shift, and ignores other keys', () => {
    const key = (key: string, mods: Partial<KeyboardEvent> = {}) =>
      findStepKey({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods })
    expect(key('Enter')).toBe(1)
    expect(key('Enter', { shiftKey: true })).toBe(-1)
    expect(key('F3')).toBe(1)
    expect(key('F3', { shiftKey: true })).toBe(-1)
    expect(key('g', { metaKey: true })).toBe(1)
    expect(key('G', { ctrlKey: true, shiftKey: true })).toBe(-1)
    expect(key('g')).toBeNull()
    expect(key('g', { ctrlKey: true, altKey: true })).toBeNull()
    expect(key('a')).toBeNull()
  })

  it('counts N of M and the hidden-column matches from the drawn rows alone, not the scenario events', () => {
    // The mounted diagram has rows but no scenario events: before searchState the total came from
    // scenario.events and the position from rows, so a row/event mismatch gave "2 of 0".
    diagramState.mounted.set('s', { rows, scenario: { events: [] } } as unknown as MountedDiagram)
    diagramView('s').query = 'order'
    diagramView('s').hidden = new Set(['a'])
    updateSearchCurrent('s')
    stepSearchCurrent('s', 1)
    const state = scenarioSearchState('s')
    expect(state.hits.map((r) => r.event.id)).toEqual(['n1', 'm2'])
    expect(state.hidden).toBe(1)
    expect(searchStateLabel(state, 'order')).toBe('2 of 2, 1 on a hidden column')
    diagramView('s').searchCurrentId = null
    expect(searchStateLabel(scenarioSearchState('s'), 'order')).toBe('3 matches, 1 on a hidden column')
  })

  it('writes the count and enables the step buttons from the state', () => {
    document.body.innerHTML = `<div class="seq-diagram"><span class="diagram-find-count"></span>
      <button data-find-step="prev" disabled></button><button data-find-step="next" disabled></button>
      <div class="seq-scroll" data-scenario-id="s"></div></div>`
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    diagramState.mounted.set('s', { rows } as unknown as MountedDiagram)
    diagramView('s').query = 'order'
    updateSearchCurrent('s')
    stepSearchCurrent('s', 1)
    syncFindControls(scroll)
    expect(document.querySelector('.diagram-find-count')!.textContent).toBe('2 of 3')
    expect([...document.querySelectorAll('button')].map((b) => b.disabled)).toEqual([false, false])
    diagramView('s').query = 'refund'
    updateSearchCurrent('s')
    syncFindControls(scroll)
    expect(document.querySelector('.diagram-find-count')!.textContent).toBe('0 matches')
    expect([...document.querySelectorAll('button')].map((b) => b.disabled)).toEqual([true, true])
  })

  it('moves the current match through the rows and reports N of M', () => {
    mount(100)
    diagramView('s').query = 'order'
    updateSearchCurrent('s')
    expect(position()).toEqual({ current: 1, count: 3 })
    expect(stepSearchCurrent('s', 1)?.event.id).toBe('n1')
    expect(stepSearchCurrent('s', 1)?.event.id).toBe('m2')
    expect(position()).toEqual({ current: 3, count: 3 })
    expect(stepSearchCurrent('s', 1)?.event.id).toBe('m1')
    expect(stepSearchCurrent('s', -1)?.event.id).toBe('m2')
    diagramView('s').hidden = new Set(['a'])
    expect(position()).toEqual({ current: 2, count: 2 })
    diagramView('s').query = 'refund'
    expect(stepSearchCurrent('s', 1)).toBeNull()
    expect(position()).toEqual({ current: 0, count: 0 })
  })
})

describe('find: payload matches', () => {
  it('counts a payload match like a label match, steps through both in drawing order, and names them', () => {
    const payloadHits = new Set(['m1', 'm9'])
    const extra = [
      ...rows,
      row({ kind: 'message', id: 'm9', from: 'c', to: 'a', label: 'ok', type: 'SYNCHRONOUS' }, 2400),
    ]
    const state = searchState(extra, 'charge', new Set(), 'm2', payloadHits)
    expect(state.hits.map((r) => r.event.id)).toEqual(['m1', 'm2', 'm9'])
    expect(state.inPayloads).toBe(2)
    expect(searchStateLabel(state, 'charge')).toBe('2 of 3, 2 in payloads')
    const hidden = searchState(extra, 'charge', new Set(['a']), null, payloadHits)
    expect(hidden.hits.map((r) => r.event.id)).toEqual(['m2'])
    expect(searchStateLabel(hidden, 'charge')).toBe('3 matches, 2 on a hidden column')
  })

  it('says when payloads are still being searched or could not be loaded', () => {
    const none = searchState(rows, 'zzz', new Set())
    expect(searchStateLabel({ ...none, pending: true }, 'zzz')).toBe('Searching payloads…')
    const some = searchState(rows, 'order', new Set(), 'm1')
    expect(searchStateLabel({ ...some, pending: true }, 'order')).toBe('1 of 3, searching payloads…')
    expect(searchStateLabel({ ...some, failed: true }, 'order')).toBe('1 of 3, payloads could not be loaded')
  })

  it('takes the payload matches for the scenario from its payload search', () => {
    diagramState.mounted.set('s', { rows } as unknown as MountedDiagram)
    diagramView('s').query = 'charge'
    diagramState.payloadFind.set('s', {
      phase: 'ready',
      entries: [],
      query: 'charge',
      hits: new Set(['m1']),
      wanted: 'charge',
      job: 1,
      onChange: () => {},
    })
    expect(updateSearchCurrent('s')?.event.id).toBe('m1')
    expect(searchStateLabel(scenarioSearchState('s'), 'charge')).toBe('1 of 2, 1 in payloads')
    diagramView('s').includePayloads = false
    expect(updateSearchCurrent('s')?.event.id).toBe('m2')
    expect(searchStateLabel(scenarioSearchState('s'), 'charge')).toBe('1 of 1')
  })
})

describe('find: the current match', () => {
  it('is the first matching row in drawing order, skipping rows on hidden columns', () => {
    expect(searchState(rows, 'order', new Set()).hits[0]?.event.id).toBe('m1')
    expect(searchState(rows, 'order', new Set(['a'])).hits[0]?.event.id).toBe('n1')
    expect(searchState(rows, 'QUEUED', new Set()).hits[0]?.event.id).toBe('n1')
    expect(searchState(rows, '  ', new Set()).hits).toEqual([])
    expect(searchState(rows, 'refund', new Set()).hits).toEqual([])
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
