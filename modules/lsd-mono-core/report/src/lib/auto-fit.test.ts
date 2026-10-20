import { describe, expect, it } from 'vitest'
import { FIT_MIN_ZOOM, fittedView, scrollportXFor } from './diagram-view'
import { diagramView } from './sequence-diagram'

const label = { x: 10, y: 40, width: 80, height: 14 }

describe('the default view', () => {
  it('shrinks a diagram wider than its panel to the readable minimum', () => {
    const view = fittedView({ contentWidth: 2000, viewportWidth: 1000, viewportHeight: 600, mustInclude: label })
    expect(view.scale).toBe(FIT_MIN_ZOOM)
  })

  it('never enlarges a narrow diagram past 100%, however wide the panel (#94)', () => {
    for (const viewportWidth of [1000, 1440, 2560]) {
      expect(fittedView({ contentWidth: 400, viewportWidth, viewportHeight: 600, mustInclude: label }).scale).toBe(1)
    }
  })

  it('starts every diagram in it, before anything has been fitted, with Overview off', () => {
    const view = diagramView('auto-fit-test-scenario')
    expect(view.autoFit).toBe(true)
    expect(view.overview).toBeNull()
    expect(view.fittedWidth).toBe(0)
  })

  it('stops at a readable minimum and scrolls sideways to keep the top label on screen', () => {
    const wide = { x: 3000, y: 20, width: 200, height: 20 }
    const fit = fittedView({ contentWidth: 4000, viewportWidth: 390, viewportHeight: 600, mustInclude: wide })
    expect(fit.scale).toBe(FIT_MIN_ZOOM)
    expect(fit.visible.width).toBeCloseTo(390 / FIT_MIN_ZOOM)
    expect(fit.originX).toBeGreaterThan(0)
    expect(wide.x + wide.width).toBeLessThanOrEqual(fit.originX + fit.visible.width + 0.01)
  })
})

describe('the readable minimum', () => {
  it('keeps 11px message labels above 10 CSS px', () => {
    expect(FIT_MIN_ZOOM * 11).toBeGreaterThanOrEqual(10)
  })

  it('fits a diagram that is only a little too wide, and stops at the minimum for a wide one', () => {
    const fit = (contentWidth: number) =>
      fittedView({ contentWidth, viewportWidth: 1000, viewportHeight: 600, mustInclude: label }).scale
    expect(fit(1050)).toBeCloseTo(1000 / 1050)
    expect(fit(2142)).toBe(FIT_MIN_ZOOM)
  })
})

describe('scrollportXFor', () => {
  it('leaves a label that is already inside', () => {
    expect(scrollportXFor(100, 400, 150, 300)).toBe(100)
  })

  it('moves right just far enough for a label past the right edge', () => {
    expect(scrollportXFor(0, 400, 450, 550)).toBe(162)
  })

  it('moves left for a label before the left edge, and never below zero', () => {
    expect(scrollportXFor(300, 400, 100, 200)).toBe(88)
    expect(scrollportXFor(300, 400, 4, 100)).toBe(0)
  })

  it('lines up the left edge of a label wider than the view', () => {
    expect(scrollportXFor(0, 300, 500, 900)).toBe(488)
  })
})
