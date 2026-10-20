// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { componentScroll, type ComponentScroll } from './inspector-components'

describe('componentScroll', () => {
  let scroll: ComponentScroll
  beforeEach(() => {
    scroll = componentScroll()
  })

  it('marks the component drawing while part of it lies past the right edge', () => {
    const scroller = document.createElement('div')
    const size = (scrollLeft: number, clientWidth: number, scrollWidth: number) => {
      Object.defineProperty(scroller, 'clientWidth', { value: clientWidth, configurable: true })
      Object.defineProperty(scroller, 'scrollWidth', { value: scrollWidth, configurable: true })
      scroller.scrollLeft = scrollLeft
    }
    size(0, 358, 516)
    scroll.bind(scroller)
    expect(scroller.hasAttribute('data-more-right')).toBe(true)
    expect(scroller.hasAttribute('data-more-left')).toBe(false)
    size(158, 358, 516)
    scroller.dispatchEvent(new Event('scroll'))
    expect(scroller.hasAttribute('data-more-right')).toBe(false)
    expect(scroller.hasAttribute('data-more-left')).toBe(true)
    expect(scroller.getAttribute('tabindex')).toBe('0')
    expect(scroller.getAttribute('role')).toBe('region')
    scroll.bind(null)
  })

  it('leaves a drawing that fits unmarked', () => {
    const scroller = document.createElement('div')
    Object.defineProperty(scroller, 'clientWidth', { value: 523 })
    Object.defineProperty(scroller, 'scrollWidth', { value: 523 })
    scroll.bind(scroller)
    expect(scroller.hasAttribute('data-more-right')).toBe(false)
    expect(scroller.hasAttribute('data-more-left')).toBe(false)
    expect(scroller.hasAttribute('tabindex')).toBe(false)
    expect(scroller.hasAttribute('role')).toBe(false)
  })

  it('binds its listeners once, however often the same drawing is bound', () => {
    const scroller = document.createElement('div')
    const link = scroller.appendChild(document.createElement('a'))
    let scrolled = 0
    link.scrollIntoView = () => {
      scrolled++
    }
    scroll.bind(scroller)
    scroll.bind(scroller)
    link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(scrolled).toBe(1)
    scroll.bind(null)
  })

  it('re-marks the edges when the box is resized, as on a rotate', () => {
    const observed: ResizeObserverCallback[] = []
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observed.push(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    try {
      const scroller = document.createElement('div')
      Object.defineProperty(scroller, 'scrollWidth', { value: 516, configurable: true })
      Object.defineProperty(scroller, 'clientWidth', { value: 516, configurable: true })
      scroll.bind(scroller)
      expect(scroller.hasAttribute('data-more-right')).toBe(false)
      Object.defineProperty(scroller, 'clientWidth', { value: 358, configurable: true })
      observed[0]([], {} as ResizeObserver)
      expect(scroller.hasAttribute('data-more-right')).toBe(true)
    } finally {
      globalThis.ResizeObserver = original
    }
  })

  it('keeps each panel its own: a second scroll does not stop the first', () => {
    const disconnected: number[] = []
    const original = globalThis.ResizeObserver
    let made = 0
    globalThis.ResizeObserver = class {
      private readonly id = made++
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected.push(this.id)
      }
    }
    try {
      const other = componentScroll()
      scroll.bind(document.createElement('div'))
      other.bind(document.createElement('div'))
      expect(disconnected).toEqual([])
      scroll.bind(null)
      expect(disconnected).toEqual([0])
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})
