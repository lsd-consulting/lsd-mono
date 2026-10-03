import { describe, expect, it } from 'vitest'
import type { DiagramEvent } from '../types'
import { activationSpans, eventRowHeight, layoutRows, virtualRowRange } from './layout'

function uniform(count: number, height = 50): { y: number; height: number }[] {
  return Array.from({ length: count }, (_, i) => ({ y: i * height, height }))
}

describe('virtualRowRange', () => {
  it('returns the rows intersecting scrollTop and viewport, plus overscan', () => {
    const rows = uniform(20, 50)
    // view [200, 300): rows y=200 and y=250. overscan 1 → indices 3..6
    expect(
      virtualRowRange({ rows, scrollTop: 200, viewportHeight: 100, overscan: 1 }),
    ).toEqual({ start: 3, end: 7 })
  })

  it('starts at the first row when scrollTop is 0', () => {
    const rows = uniform(10, 40)
    // view [0, 100): rows y=0, 40, 80
    expect(
      virtualRowRange({ rows, scrollTop: 0, viewportHeight: 100, overscan: 0 }),
    ).toEqual({ start: 0, end: 3 })
  })

  it('shrinks the visible body by the sticky header height', () => {
    const rows = uniform(10, 50)
    // header 40 of viewport 140 → visible body [0, 100): rows y=0 and y=50
    expect(
      virtualRowRange({
        rows,
        scrollTop: 0,
        viewportHeight: 140,
        headerHeight: 40,
        overscan: 0,
      }),
    ).toEqual({ start: 0, end: 2 })
  })

  it('clamps to the tail when scrolled past the last row', () => {
    const rows = uniform(4, 50)
    expect(
      virtualRowRange({ rows, scrollTop: 500, viewportHeight: 100, overscan: 1 }),
    ).toEqual({ start: 3, end: 4 })
  })

  it('returns an empty range when there are no rows', () => {
    expect(virtualRowRange({ rows: [], scrollTop: 0, viewportHeight: 400 })).toEqual({
      start: 0,
      end: 0,
    })
  })
})

describe('activationSpans', () => {
  it('keeps an activation open across a section row', () => {
    const events: DiagramEvent[] = [
      { kind: 'activate', id: 'a', participantId: 'api' },
      { kind: 'message', id: 'm1', from: 'api', to: 'db', label: 'read', type: 'SYNCHRONOUS' },
      { kind: 'section', id: 's', title: 'Phase 2' },
      { kind: 'message', id: 'm2', from: 'db', to: 'api', label: 'rows', type: 'SYNCHRONOUS_RESPONSE' },
      { kind: 'deactivate', id: 'd', participantId: 'api' },
    ]
    const rows = layoutRows(events)
    const section = rows.find((r) => r.event.kind === 'section')!
    const spans = activationSpans(rows, rows[rows.length - 1].y + rows[rows.length - 1].height)
    expect(spans).toHaveLength(1)
    expect(spans[0].participantId).toBe('api')
    expect(spans[0].y0).toBeLessThan(section.y)
    expect(spans[0].y1).toBeGreaterThan(section.y + section.height)
  })
})

describe('eventRowHeight', () => {
  it('maps delay and spacer kinds, clamping custom spacer height', () => {
    expect(eventRowHeight({ kind: 'delay', id: 'd1', label: 'wait' })).toBe(36)
    expect(eventRowHeight({ kind: 'spacer', id: 's1' })).toBe(24)
    expect(eventRowHeight({ kind: 'spacer', id: 's2', heightPx: 80 })).toBe(80)
    expect(eventRowHeight({ kind: 'spacer', id: 's3', heightPx: 4 })).toBe(12)
    expect(eventRowHeight({ kind: 'spacer', id: 's4', heightPx: 999 })).toBe(240)
  })
})
