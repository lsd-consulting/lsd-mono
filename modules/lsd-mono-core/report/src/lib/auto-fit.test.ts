import { describe, expect, it } from 'vitest'
import { AUTO_FIT_MAX_ZOOM, FIT_MIN_ZOOM, MAX_ZOOM, fittedView } from './diagram-view'
import { diagramView } from './sequence-diagram'

const label = { x: 10, y: 40, width: 80, height: 14 }

describe('automatic fit', () => {
  it('shrinks a diagram wider than its panel, like Fit', () => {
    const fit = fittedView({ contentWidth: 2000, viewportWidth: 1000, viewportHeight: 600, mustInclude: label })
    const auto = fittedView({
      contentWidth: 2000,
      viewportWidth: 1000,
      viewportHeight: 600,
      mustInclude: label,
      maxScale: AUTO_FIT_MAX_ZOOM,
    })
    expect(auto.scale).toBe(0.5)
    expect(auto.scale).toBe(fit.scale)
  })

  it('does not enlarge a narrow diagram past 100%, where Fit fills the width', () => {
    const fit = fittedView({ contentWidth: 400, viewportWidth: 1000, viewportHeight: 600, mustInclude: label })
    const auto = fittedView({
      contentWidth: 400,
      viewportWidth: 1000,
      viewportHeight: 600,
      mustInclude: label,
      maxScale: AUTO_FIT_MAX_ZOOM,
    })
    expect(fit.scale).toBe(MAX_ZOOM)
    expect(auto.scale).toBe(1)
  })

  it('starts every diagram in automatic fit, before anything has been fitted', () => {
    const view = diagramView('auto-fit-test-scenario')
    expect(view.autoFit).toBe(true)
    expect(view.fitLimit).toBe(AUTO_FIT_MAX_ZOOM)
    expect(view.fittedWidth).toBe(0)
  })

  it('stops Fit at a readable minimum and scrolls sideways to keep the top label on screen', () => {
    const wide = { x: 3000, y: 20, width: 200, height: 20 }
    const fit = fittedView({ contentWidth: 4000, viewportWidth: 390, viewportHeight: 600, mustInclude: wide })
    expect(fit.scale).toBe(FIT_MIN_ZOOM)
    expect(fit.visible.width).toBeCloseTo(780)
    expect(fit.originX).toBeGreaterThan(0)
    expect(wide.x + wide.width).toBeLessThanOrEqual(fit.originX + fit.visible.width + 0.01)
  })
})
