// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Metric } from '../types'
import { componentGraph } from '../lib/component-graph'
import {
  INSPECTOR_NARROW_PX,
  INSPECTOR_VIEW_GUTTER_PX,
  INSPECTOR_WIDTH_KEY,
  TIMING_VIEW_MIN_PX,
  bindInspector,
  fitViewWidth,
  inspectorMarkup,
  inspectorWidthLimits,
  naturalWidth,
} from './inspector'

const metrics: Metric[] = [{ key: 'Messages', value: '14' }]

function graph(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `p${i}`)
  return componentGraph({
    participants: ids.map((id) => ({ id, name: `Service number ${id}`, type: 'PARTICIPANT' as const })),
    events: ids.slice(1).map((to, i) => ({
      kind: 'message' as const,
      id: String(i),
      from: 'p0',
      to,
      label: `call ${to}`,
      type: 'SYNCHRONOUS' as const,
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

  it('sizes the component diagram to its drawing on desktop, and keeps the saved message width', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600)
    const controller = bind()
    controller.openComponents('s', graph(8), 'Wide')
    const wide = parseFloat(width())
    expect(wide).toBeGreaterThan(INSPECTOR_NARROW_PX)
    expect(wide).toBeLessThanOrEqual(800)
    controller.openComponents('s', graph(2), 'Small')
    expect(parseFloat(width())).toBeLessThan(wide)
    expect(parseFloat(width())).toBeGreaterThanOrEqual(INSPECTOR_NARROW_PX)
    expect(sessionStorage.getItem(INSPECTOR_WIDTH_KEY)).toBeNull()
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
    bind().openComponents('s', graph(8), 'Wide')
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
    controller.openComponents('s', graph(8), 'Wide')
    expect(width()).toBe(phone)
  })
})
