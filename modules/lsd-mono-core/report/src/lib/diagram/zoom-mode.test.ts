import { describe, expect, it } from 'vitest'
import type { ZoomMode } from './state'
import { defaultMode, fittedWidthOf, zoomModeAfter } from './zoom-mode'

const at = { zoom: 0.8, top: 120, left: 40 }
const fitted: ZoomMode = { kind: 'default', fittedWidth: 1200 }
const zoomed: ZoomMode = { kind: 'zoomed' }
const overviewFrom = (mode: ZoomMode): ZoomMode => zoomModeAfter(mode, { kind: 'enter-overview', at })

describe('zoomModeAfter', () => {
  it('opens in the default view, not yet fitted', () => {
    expect(defaultMode()).toEqual({ kind: 'default', fittedWidth: 0 })
  })

  it('default → zoomed on a step, and zoomed → default on reset', () => {
    expect(zoomModeAfter(fitted, { kind: 'step' })).toEqual(zoomed)
    expect(zoomModeAfter(zoomed, { kind: 'step' })).toEqual(zoomed)
    expect(zoomModeAfter(zoomed, { kind: 'reset' })).toEqual(defaultMode())
    expect(zoomModeAfter(fitted, { kind: 'reset' })).toEqual(defaultMode())
  })

  it('default → Overview → default, keeping the fit it had', () => {
    const on = overviewFrom(fitted)
    expect(on).toEqual({ kind: 'overview', fittedWidth: 0, saved: { ...at, mode: fitted } })
    expect(zoomModeAfter(on, { kind: 'leave-overview' })).toEqual(fitted)
  })

  it('zoomed → Overview → zoomed', () => {
    const on = overviewFrom(zoomed)
    expect(on).toEqual({ kind: 'overview', fittedWidth: 0, saved: { ...at, mode: zoomed } })
    expect(zoomModeAfter(on, { kind: 'leave-overview' })).toEqual(zoomed)
  })

  it('Overview → zoomed on a step, and Overview → default on reset, without going back', () => {
    expect(zoomModeAfter(overviewFrom(fitted), { kind: 'step' })).toEqual(zoomed)
    expect(zoomModeAfter(overviewFrom(zoomed), { kind: 'reset' })).toEqual(defaultMode())
  })

  it('turning Overview on twice keeps the first saved view; off when it is off changes nothing', () => {
    const on = overviewFrom(zoomed)
    expect(zoomModeAfter(on, { kind: 'enter-overview', at: { zoom: 2, top: 0, left: 0 } })).toBe(on)
    expect(zoomModeAfter(fitted, { kind: 'leave-overview' })).toBe(fitted)
    expect(zoomModeAfter(zoomed, { kind: 'leave-overview' })).toBe(zoomed)
  })

  it('a fit is kept by the default view and Overview, not by a zoom of the user’s own', () => {
    expect(zoomModeAfter(defaultMode(), { kind: 'fitted', width: 900 })).toEqual({ kind: 'default', fittedWidth: 900 })
    expect(zoomModeAfter(overviewFrom(zoomed), { kind: 'fitted', width: 900 })).toMatchObject({
      kind: 'overview',
      fittedWidth: 900,
      saved: { mode: zoomed },
    })
    expect(zoomModeAfter(zoomed, { kind: 'fitted', width: 900 })).toBe(zoomed)
  })

  it('refit forgets only the default view’s fit', () => {
    expect(zoomModeAfter(fitted, { kind: 'refit' })).toEqual(defaultMode())
    expect(zoomModeAfter(zoomed, { kind: 'refit' })).toBe(zoomed)
    const on = zoomModeAfter(overviewFrom(fitted), { kind: 'fitted', width: 900 })
    expect(zoomModeAfter(on, { kind: 'refit' })).toBe(on)
  })

  it('lanes hidden or shown forget the default view’s fit, also the one Overview goes back to', () => {
    expect(zoomModeAfter(fitted, { kind: 'lanes-changed' })).toEqual(defaultMode())
    expect(zoomModeAfter(zoomed, { kind: 'lanes-changed' })).toBe(zoomed)
    const fromFitted = zoomModeAfter(overviewFrom(fitted), { kind: 'fitted', width: 900 })
    expect(zoomModeAfter(fromFitted, { kind: 'lanes-changed' })).toEqual({
      kind: 'overview',
      fittedWidth: 900,
      saved: { ...at, mode: defaultMode() },
    })
    const fromZoomed = overviewFrom(zoomed)
    expect(zoomModeAfter(fromZoomed, { kind: 'lanes-changed' })).toEqual(fromZoomed)
  })

  it('fittedWidthOf is the last fit width, or null for a zoom of the user’s own', () => {
    expect(fittedWidthOf(fitted)).toBe(1200)
    expect(fittedWidthOf(overviewFrom(fitted))).toBe(0)
    expect(fittedWidthOf(zoomed)).toBeNull()
  })
})
