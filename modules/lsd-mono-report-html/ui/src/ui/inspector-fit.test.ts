// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Metric } from '../types'
import { componentGraph } from '../lib/component-graph'
import { bindInspector, inspectorMarkup } from './inspector'
import {
  INSPECTOR_NARROW_PX,
  INSPECTOR_VIEW_GUTTER_PX,
  TIMING_VIEW_MIN_PX,
  fitViewWidth,
  inspectorWidthLimits,
  naturalWidth,
} from './inspector-width'

const metrics: Metric[] = [{ key: 'Messages', value: '14' }]

function graph(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `p${i}`)
  return componentGraph({
    participants: ids.map((id) => ({ id, name: `Service number ${id}`, type: 'participant' as const })),
    events: ids.slice(1).map((to, i) => ({
      kind: 'message' as const,
      id: String(i),
      from: 'p0',
      to,
      label: `call ${to}`,
      type: 'synchronous' as const,
    })),
  })
}

const width = () => document.querySelector<HTMLElement>('.shell')!.style.getPropertyValue('--inspector-w')

function bind() {
  return bindInspector(document, { loadPayload: async () => ({}), onClose: () => {} })
}

describe('fitViewWidth', () => {
  it('fits the content plus a gutter', () => {
    expect(fitViewWidth(500, 1600)).toBe(500 + INSPECTOR_VIEW_GUTTER_PX)
  })
  it('is never narrower than the message column', () => {
    expect(fitViewWidth(40, 1600)).toBe(INSPECTOR_NARROW_PX)
  })
  it('takes at most half the viewport, so the diagram keeps room', () => {
    expect(fitViewWidth(5000, 1600)).toBe(800)
    expect(fitViewWidth(5000, 1000)).toBe(500)
    expect(fitViewWidth(5000, 1000)).toBeLessThanOrEqual(inspectorWidthLimits(1000).expand)
  })
  it('keeps the message column on a narrow desktop', () => {
    expect(fitViewWidth(5000, 900)).toBe(450)
    expect(fitViewWidth(5000, 700)).toBe(INSPECTOR_NARROW_PX)
  })
})

describe('naturalWidth', () => {
  it('measures without the width limit and restores the style', () => {
    const host = document.createElement('div')
    host.style.width = '120px'
    vi.spyOn(host, 'scrollWidth', 'get').mockReturnValue(610)
    expect(naturalWidth(host)).toBe(610)
    expect(host.style.width).toBe('120px')
  })
})

describe('panel auto-size', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.body.innerHTML = `<div class="shell">${inspectorMarkup()}</div>`
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sizes metrics to their content on desktop', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(700)
    bind().openMetrics('s', { heading: 'Pay', metrics })
    expect(width()).toBe(`${700 + INSPECTOR_VIEW_GUTTER_PX}px`)
  })

  it('gives the timing view room for its lanes', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(200)
    bind().openMetrics('s', { heading: 'Pay', metrics, timingHtml: '<p>lanes</p>' })
    expect(width()).toBe(`${TIMING_VIEW_MIN_PX + INSPECTOR_VIEW_GUTTER_PX}px`)
  })

  it('leaves a drag free to resize after an auto-size', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(700)
    bind().openMetrics('s', { heading: 'Pay', metrics })
    const before = parseFloat(width())
    const handle = document.querySelector<HTMLElement>('#inspector-resize')!
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    expect(parseFloat(width())).toBe(before + 24)
  })

  it('does nothing on a phone, where the panel is the page width', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(700)
    const controller = bind()
    controller.openMetrics('s', { heading: 'Pay', metrics })
    const phone = width()
    controller.openLink('s', graph(8), 0, 'Wide')
    expect(width()).toBe(phone)
  })
})

describe('reveal on a phone', () => {
  beforeEach(() => {
    sessionStorage.clear()
    document.body.innerHTML = `<div class="shell">${inspectorMarkup()}</div>`
    // Everything the panel holds sits far below the screen.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 2000, 300, 200))
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function scrollsWhenOpenedAt(viewport: number): Promise<number> {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewport)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const controller = bind()
    controller.openLink('s', graph(3), 0, 'Small')
    controller.openMetrics('s', { heading: 'Pay', metrics })
    controller.openMessage('s', {
      kind: 'message',
      id: 'm1',
      from: 'a',
      to: 'b',
      label: 'call',
      type: 'synchronous',
      data: { id: 1 },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    return scrollTo.mock.calls.length
  }

  it('scrolls each view and the message JSON into view up to the stacked width', async () => {
    expect(await scrollsWhenOpenedAt(390)).toBe(3)
    vi.restoreAllMocks()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 2000, 300, 200))
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700)
    expect(await scrollsWhenOpenedAt(860)).toBe(3)
  })

  it('never scrolls above 860px, where the panel is a side column', async () => {
    expect(await scrollsWhenOpenedAt(861)).toBe(0)
    vi.restoreAllMocks()
    expect(await scrollsWhenOpenedAt(1400)).toBe(0)
  })
})
