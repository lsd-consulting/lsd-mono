// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { Scenario } from '../types'
import {
  bindComponentViews,
  componentViewHtml,
  markComponentScroll,
  mountedComponents,
  moreEdges,
} from './component-view'

const scenario = {
  id: 'pay',
  title: 'Pay',
  status: 'success',
  facts: [],
  metrics: [],
  participants: [
    { id: 'a', name: 'Shop', type: 'participant' },
    { id: 'b', name: 'Bank', type: 'participant' },
  ],
  events: [
    { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'charge', type: 'synchronous' },
    { kind: 'message', id: 'm2', from: 'b', to: 'a', label: 'charged', type: 'asynchronous' },
  ],
} as unknown as Scenario

function sized(el: HTMLElement, size: Record<string, number>): void {
  for (const [key, value] of Object.entries(size)) Object.defineProperty(el, key, { value, configurable: true })
}

describe('the Components view (#105)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('draws the drawing in its own scrollport, sized by the scrollport, with the toolbar given', () => {
    document.body.innerHTML = componentViewHtml(scenario, '<button data-show-metrics="pay">Metrics</button>')
    const scroller = document.querySelector<HTMLElement>('.comp-scroll')!
    const drawn = mountedComponents('pay')!
    expect(drawn.graph.edges).toHaveLength(2)
    expect(scroller.dataset.scenarioId).toBe('pay')
    expect(scroller.style.getPropertyValue('--comp-w')).toBe(`${drawn.width}px`)
    expect(scroller.style.getPropertyValue('--comp-h')).toBe(`${drawn.height}px`)
    // The drawing's own max-width would pin it to its natural size.
    expect(scroller.querySelector('svg')!.getAttribute('style')).toBeNull()
    expect(document.querySelector('.comp-toolbar [data-show-metrics]')).not.toBeNull()
  })

  it('says which edges have more of the drawing past them', () => {
    const box = { scrollWidth: 900, clientWidth: 400, scrollHeight: 300, clientHeight: 300 }
    expect(moreEdges({ ...box, scrollLeft: 0, scrollTop: 0 })).toEqual({
      left: false,
      right: true,
      up: false,
      down: false,
    })
    expect(moreEdges({ ...box, scrollLeft: 500, scrollTop: 0 })).toEqual({
      left: true,
      right: false,
      up: false,
      down: false,
    })
    const tall = { scrollWidth: 400, clientWidth: 400, scrollHeight: 900, clientHeight: 300 }
    expect(moreEdges({ ...tall, scrollLeft: 0, scrollTop: 300 })).toEqual({
      left: false,
      right: false,
      up: true,
      down: true,
    })
  })

  it('marks the edges, and is a named region with a tab stop only while it overflows', () => {
    const scroller = document.createElement('div')
    sized(scroller, { scrollWidth: 900, clientWidth: 400, scrollHeight: 300, clientHeight: 300 })
    markComponentScroll(scroller)
    expect(scroller.hasAttribute('data-more-right')).toBe(true)
    expect(scroller.getAttribute('role')).toBe('region')
    expect(scroller.tabIndex).toBe(0)
    sized(scroller, { scrollWidth: 400 })
    markComponentScroll(scroller)
    expect(scroller.hasAttribute('data-more-right')).toBe(false)
    expect(scroller.hasAttribute('role')).toBe(false)
    expect(scroller.hasAttribute('tabindex')).toBe(false)
  })

  it('keeps the tab stop of a drawing that has focus when it comes to fit, until focus leaves', () => {
    const scroller = document.createElement('div')
    document.body.append(scroller)
    sized(scroller, { scrollWidth: 900, clientWidth: 400, scrollHeight: 300, clientHeight: 300 })
    markComponentScroll(scroller)
    scroller.focus()
    sized(scroller, { scrollWidth: 400 })
    markComponentScroll(scroller)
    markComponentScroll(scroller)
    expect(document.activeElement).toBe(scroller)
    expect(scroller.tabIndex).toBe(0)
    expect(scroller.getAttribute('role')).toBe('region')
    scroller.blur()
    expect(scroller.hasAttribute('tabindex')).toBe(false)
    expect(scroller.hasAttribute('data-keep-stop')).toBe(false)
    scroller.remove()
  })

  it('opens a link that is clicked or pressed with Enter or Space, and marks it selected', () => {
    document.body.innerHTML = componentViewHtml(scenario, '')
    const opened: [string, number][] = []
    bindComponentViews(document, (id, edge) => opened.push([id, edge]))
    const links = document.querySelectorAll<SVGGElement>('.edge-group')
    links[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    links[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    links[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    links[1].dispatchEvent(space)
    expect(space.defaultPrevented, 'Space does not scroll the page').toBe(true)
    expect(opened).toEqual([
      ['pay', 1],
      ['pay', 0],
      ['pay', 1],
    ])
    expect([...links].map((link) => link.classList.contains('is-selected'))).toEqual([false, true])
  })

  it('scrolls a link that takes focus into view', () => {
    document.body.innerHTML = componentViewHtml(scenario, '')
    bindComponentViews(document, () => {})
    const link = document.querySelector<SVGGElement>('.edge-group')!
    let scrolled = 0
    link.scrollIntoView = () => {
      scrolled++
    }
    link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(scrolled).toBe(1)
  })
})
