// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { stickyLead, trackHeightVar, trackTopbarHeight } from './topbar-height'

/** A ResizeObserver stand-in the test can fire by hand. */
function fakeObserver() {
  const live: { fire: () => void; disconnected: boolean }[] = []
  class Fake {
    private readonly cb: () => void
    disconnected = false
    constructor(cb: () => void) {
      this.cb = cb
      live.push(this)
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.disconnected = true
    }
    fire() {
      this.cb()
    }
  }
  return { Observer: Fake as unknown as typeof ResizeObserver, live }
}

function barOfHeight(initial: number) {
  const bar = document.createElement('header')
  let height = initial
  bar.getBoundingClientRect = () => ({ height }) as DOMRect
  return {
    bar,
    setHeight: (h: number) => {
      height = h
    },
  }
}

describe('trackTopbarHeight', () => {
  it('sets --topbar-h to the bar height now and whenever the bar resizes', () => {
    const root = document.createElement('div')
    const { bar, setHeight } = barOfHeight(56)
    const { Observer, live } = fakeObserver()
    trackTopbarHeight(bar, root, Observer)
    expect(root.style.getPropertyValue('--topbar-h')).toBe('56px')

    setHeight(131.4) // a phone: the bar wraps onto three rows
    live[0].fire()
    expect(root.style.getPropertyValue('--topbar-h')).toBe('132px')
  })

  it('keeps the last height while the bar has none (hidden for print), and stops when asked', () => {
    const root = document.createElement('div')
    const { bar, setHeight } = barOfHeight(56)
    const { Observer, live } = fakeObserver()
    const stop = trackTopbarHeight(bar, root, Observer)
    setHeight(0)
    live[0].fire()
    expect(root.style.getPropertyValue('--topbar-h')).toBe('56px')
    stop()
    expect(live[0].disconnected).toBe(true)
  })

  it('sets the height once when there is no ResizeObserver', () => {
    const root = document.createElement('div')
    const { bar } = barOfHeight(90)
    trackTopbarHeight(bar, root, undefined)()
    expect(root.style.getPropertyValue('--topbar-h')).toBe('90px')
  })
})

describe('trackHeightVar (#116)', () => {
  it('keeps the variable at the element height, skips while it is hidden, and stops when asked', () => {
    const target = document.createElement('aside')
    const { bar: head, setHeight } = barOfHeight(0) // the panel starts hidden
    const { Observer, live } = fakeObserver()
    const stop = trackHeightVar(head, target, '--inspector-head-h', Observer)
    expect(target.style.getPropertyValue('--inspector-head-h')).toBe('')
    setHeight(64.6)
    live[0].fire()
    expect(target.style.getPropertyValue('--inspector-head-h')).toBe('65px')
    setHeight(98) // a long title wraps
    live[0].fire()
    expect(target.style.getPropertyValue('--inspector-head-h')).toBe('98px')
    setHeight(0)
    live[0].fire()
    expect(target.style.getPropertyValue('--inspector-head-h')).toBe('98px')
    stop()
    expect(live[0].disconnected).toBe(true)
    expect(trackHeightVar(head, target, '--x', undefined)).toBeTypeOf('function')
  })
})

describe('stickyLead', () => {
  it('lets a phone bar scroll its first row away and keeps a wide one whole', () => {
    expect(stickyLead(0, 58)).toBe(50) // search on the second row
    expect(stickyLead(0, 10)).toBe(0) // search on the first row
  })
})
