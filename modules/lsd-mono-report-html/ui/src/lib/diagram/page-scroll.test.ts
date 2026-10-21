// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindPageScroll, keepOnPage, scrollDiagramTo, shownHeight, sizeStage } from './page-scroll'
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

  it('on a phone only the toolbar row with Find stays stuck: the rows above it are the lead', () => {
    const { scroll } = mount(5000, 800, 300)
    const toolbar = document.querySelector<HTMLElement>('.seq-toolbar')!
    toolbar.innerHTML = '<label class="diagram-find"></label>'
    Object.defineProperty(toolbar, 'offsetHeight', { value: 130, configurable: true })
    Object.defineProperty(toolbar.firstElementChild!, 'offsetTop', { value: 90, configurable: true })
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 560px') }))
    sizeStage(scroll)
    const diagram = scroll.closest<HTMLElement>('.seq-diagram')!
    expect(diagram.style.getPropertyValue('--seq-toolbar-lead')).toBe('82px')
    expect(diagram.style.getPropertyValue('--seq-toolbar-h')).toBe('48px')
    vi.unstubAllGlobals()
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

describe('room below the stage on a phone (#80, #113)', () => {
  /** On a phone, a stage [content] px tall with [room] px of page under it, its top at [stageTop]. */
  function mountPhone(content: number, room: number, stageTop: number) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 560px') }))
    const mounted = mount(content, 800, stageTop)
    let top = stageTop
    mounted.stage.getBoundingClientRect = () => ({ top, bottom: top + content }) as DOMRect
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: window.scrollY + stageTop + content + room,
      configurable: true,
    })
    const below = () => mounted.scroll.closest<HTMLElement>('.seq-diagram')!.style.getPropertyValue('--seq-below')
    const scrollPage = (stageBottom: number) => {
      top = stageBottom - content
      window.dispatchEvent(new Event('scroll'))
    }
    return { ...mounted, below, scrollPage }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document.documentElement, 'scrollHeight')
  })

  it('leaves none of the room out while the page has it still to scroll, so the drawing fills the screen', () => {
    const { scroll, below, scrollPage } = mountPhone(5000, 122, 300)
    bindPageScroll(scroll)
    expect(below()).toBe('0px')
    scrollPage(innerHeight + 400)
    expect(below()).toBe('0px')
    // Exactly the room left to scroll: the stage's end is at the bottom of the screen.
    scrollPage(innerHeight)
    expect(below()).toBe('0px')
  })

  it('leaves out what of the room has come up, all of it at the page end', () => {
    const { scroll, below, scrollPage } = mountPhone(5000, 122, 300)
    bindPageScroll(scroll)
    scrollPage(innerHeight - 50)
    expect(below()).toBe('50px')
    scrollPage(innerHeight - 122)
    expect(below()).toBe('122px')
    // Never more than the room, should the page scroll past it (an open inspector under the report).
    scrollPage(innerHeight - 400)
    expect(below()).toBe('122px')
    // And back again on the way up.
    scrollPage(innerHeight + 10)
    expect(below()).toBe('0px')
  })

  it('fits the scrollport before it follows the page, so its scrollTop reaches the drawing end', () => {
    const content = 5000
    const { scroll, below, scrollPage } = mountPhone(content, 122, 300)
    // The scrollport is 800px tall less what it leaves out.
    Object.defineProperty(scroll, 'clientHeight', {
      get: () => 800 - (Number.parseFloat(below()) || 0),
      configurable: true,
    })
    bindPageScroll(scroll)
    scrollPage(innerHeight - 122)
    expect(below()).toBe('122px')
    expect(scroll.scrollTop).toBe(content - 678)
  })

  it('leaves a desktop scrollport its full height', () => {
    const { scroll } = mount(5000, 800, 300)
    bindPageScroll(scroll)
    expect(scroll.closest<HTMLElement>('.seq-diagram')!.style.getPropertyValue('--seq-below')).toBe('0px')
  })
})

describe('a focused message on the page (#113)', () => {
  /** A scrollport [port] px tall with its top [portTop] px down the window and its header 56px tall. */
  function mountPort(portTop: number, port = 800) {
    const mounted = mount(5000, port, portTop)
    const header = document.createElement('div')
    header.className = 'seq-sticky-header'
    mounted.scroll.append(header)
    header.getBoundingClientRect = () => ({ bottom: portTop + 56 }) as DOMRect
    mounted.scroll.getBoundingClientRect = () => ({ top: portTop, bottom: portTop + port }) as DOMRect
    const el = document.createElement('button')
    mounted.scroll.append(el)
    const place = (top: number, height = 44) => {
      el.getBoundingClientRect = () => ({ top, bottom: top + height }) as DOMRect
    }
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    return { ...mounted, el, place, scrollTo }
  }

  it('counts only the part of the scrollport above the window bottom as shown', () => {
    expect(shownHeight(mountPort(innerHeight - 300).scroll)).toBe(300)
    expect(shownHeight(mountPort(56, 400).scroll)).toBe(400)
    expect(shownHeight(mountPort(innerHeight + 10).scroll)).toBe(0)
  })

  it('moves the page up just enough, and a little more, for a message below the window', () => {
    const { scroll, el, place, scrollTo } = mountPort(300)
    place(innerHeight - 20)
    expect(keepOnPage(scroll, el, 8)).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith({ top: window.scrollY + 24 + 8, behavior: 'instant' })
  })

  it('moves the page down for a message under the sticky header', () => {
    const { scroll, el, place, scrollTo } = mountPort(56)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(500)
    place(100)
    expect(keepOnPage(scroll, el, 8)).toBe(true)
    expect(scrollTo).toHaveBeenCalledWith({ top: 500 - 12 - 8, behavior: 'instant' })
  })

  it('leaves the page alone for a message on screen, and in print', () => {
    const { scroll, el, place, scrollTo } = mountPort(56, 600)
    place(300)
    expect(keepOnPage(scroll, el, 8)).toBe(false)
    diagramState.printAllRows = true
    place(innerHeight + 50)
    expect(keepOnPage(scroll, el, 8)).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
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
