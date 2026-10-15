// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindPageScroll, scrollDiagramTo, sizeStage } from './page-scroll'
import { diagramState, diagramView } from './state'

/** A diagram whose drawing is [content] px tall in a scrollport [port] px tall, stage top at [stageTop]. */
function mount(content: number, port: number, stageTop: number) {
  document.body.innerHTML = `<div class="seq-diagram"><div class="seq-toolbar" style="position: sticky"></div>
    <div class="seq-stage"><div class="seq-scroll" style="position: sticky; top: 56px"></div></div></div>`
  const stage = document.querySelector<HTMLElement>('.seq-stage')!
  const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
  const toolbar = document.querySelector<HTMLElement>('.seq-toolbar')!
  Object.defineProperty(scroll, 'scrollHeight', { value: content, configurable: true })
  Object.defineProperty(scroll, 'clientHeight', { value: port, configurable: true })
  Object.defineProperty(scroll, 'offsetHeight', { value: port, configurable: true })
  Object.defineProperty(toolbar, 'offsetHeight', { value: 40, configurable: true })
  let top = stageTop
  stage.getBoundingClientRect = () => ({ top }) as DOMRect
  return { stage, scroll, moveStage: (next: number) => (top = next) }
}

afterEach(() => {
  diagramState.printAllRows = false
  vi.restoreAllMocks()
})

describe('page scroll', () => {
  it('makes the stage as tall as the drawing', () => {
    const { stage, scroll } = mount(5000, 800, 300)
    sizeStage(scroll)
    expect(stage.style.height).toBe('5000px')
    expect(stage.closest<HTMLElement>('.seq-diagram')!.style.getPropertyValue('--seq-toolbar-h')).toBe('40px')
  })

  it('leaves the stage to its own height in print', () => {
    const { stage, scroll } = mount(5000, 800, 300)
    sizeStage(scroll)
    diagramState.printAllRows = true
    sizeStage(scroll)
    expect(stage.style.height).toBe('')
  })

  it('carries the page position past the stage top into scrollTop, clamped to the drawing', () => {
    const { scroll, moveStage } = mount(5000, 800, 300)
    bindPageScroll(scroll)
    expect(scroll.scrollTop).toBe(0)
    moveStage(56 - 1200)
    window.dispatchEvent(new Event('scroll'))
    expect(scroll.scrollTop).toBe(1200)
    moveStage(56 - 9000)
    window.dispatchEvent(new Event('scroll'))
    expect(scroll.scrollTop).toBe(4200)
  })

  it('scrolls the page when the diagram moves its own scrollTop', () => {
    const { scroll } = mount(5000, 800, 56)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    bindPageScroll(scroll)
    scroll.scrollTop = 700
    scroll.dispatchEvent(new Event('scroll'))
    expect(scrollTo).toHaveBeenCalledWith({ top: window.scrollY + 700, behavior: 'instant' })
  })
})

describe('section jump', () => {
  it('moves the page so the row sits at the top of the diagram, at the current zoom, even when the drawing fits', () => {
    const { scroll } = mount(566, 566, 300)
    scroll.dataset.scenarioId = 'sections'
    diagramView('sections').zoom = 0.5
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    scrollDiagramTo(scroll, 648)
    expect(scrollTo).toHaveBeenCalledWith({ top: window.scrollY + 300 - 56 + 324, behavior: 'instant' })
  })

  it('scrolls the scrollport itself when it is not linked to the page (print)', () => {
    const { scroll } = mount(5000, 800, 300)
    scroll.dataset.scenarioId = 'print'
    diagramView('print').zoom = 2
    diagramState.printAllRows = true
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    scrollDiagramTo(scroll, 100)
    expect(scroll.scrollTop).toBe(200)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
