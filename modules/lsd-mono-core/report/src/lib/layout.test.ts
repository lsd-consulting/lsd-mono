import { describe, expect, it } from 'vitest'
import type { DiagramEvent } from '../types'
import { MESSAGE_LABEL_RISE, TOP_LABEL_PAD, activationSpans, eventRowHeight, layoutRows, sortEventsByCreatedAt, virtualRowRange } from './layout'

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
  it('pins the bar to the message before activate and the message before deactivate', () => {
    const events: DiagramEvent[] = [
      { kind: 'message', id: 'open', from: 'client', to: 'api', label: 'POST /orders', type: 'SYNCHRONOUS' },
      { kind: 'activate', id: 'a', participantId: 'api' },
      { kind: 'message', id: 'mid', from: 'api', to: 'db', label: 'insert order', type: 'SYNCHRONOUS' },
      { kind: 'message', id: 'close', from: 'api', to: 'client', label: '201 Created', type: 'SYNCHRONOUS_RESPONSE' },
      { kind: 'deactivate', id: 'd', participantId: 'api' },
    ]
    const rows = layoutRows(events)
    const byId = new Map(rows.map((row) => [row.event.id, row]))
    expect(byId.get('a')!.height).toBe(0)
    expect(byId.get('d')!.height).toBe(0)
    expect(byId.get('mid')!.y).toBe(byId.get('open')!.y + byId.get('open')!.height)
    const spans = activationSpans(rows, 999)
    expect(spans).toEqual([
      { participantId: 'api', y0: byId.get('open')!.y, y1: byId.get('close')!.y, colour: undefined },
    ])
  })

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
    expect(spans[0].y1).toBeGreaterThanOrEqual(section.y + section.height)
  })
})

describe('layoutRows', () => {
  it('starts the first row below the message-label rise so the label is inside the body', () => {
    const rows = layoutRows([
      { kind: 'message', id: 'm', from: 'a', to: 'b', label: 'place order', type: 'SYNCHRONOUS' },
    ])
    expect(TOP_LABEL_PAD).toBeGreaterThan(MESSAGE_LABEL_RISE)
    expect(rows[0].y).toBe(TOP_LABEL_PAD)
    expect(rows[0].y - MESSAGE_LABEL_RISE).toBeGreaterThanOrEqual(0)
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

describe('sortEventsByCreatedAt', () => {
  it('sorts out-of-order timestamps and leaves untimed events last', () => {
    const events: DiagramEvent[] = [
      { kind: 'message', id: 'late', from: 'a', to: 'b', label: 'late', type: 'SYNCHRONOUS', createdAt: '2026-10-03T11:00:00Z' },
      { kind: 'message', id: 'early', from: 'a', to: 'b', label: 'early', type: 'SYNCHRONOUS', createdAt: '2026-10-03T09:00:00Z' },
      { kind: 'divider', id: 'plain', label: 'untimed' },
      { kind: 'message', id: 'mid', from: 'a', to: 'b', label: 'mid', type: 'SYNCHRONOUS', createdAt: '2026-10-03T10:00:00Z' },
    ]
    expect(sortEventsByCreatedAt(events).map((e) => e.id)).toEqual(['early', 'mid', 'late', 'plain'])
    expect(layoutRows(events).map((r) => r.event.id)).toEqual(['early', 'mid', 'late', 'plain'])
  })

  it('keeps capture order when no event has createdAt', () => {
    const events: DiagramEvent[] = [
      { kind: 'activate', id: 'a', participantId: 'api' },
      { kind: 'message', id: 'm', from: 'api', to: 'db', label: 'read', type: 'SYNCHRONOUS' },
    ]
    expect(sortEventsByCreatedAt(events)).toBe(events)
  })
})

describe('activation colour', () => {
  it('copies an activate colour onto the span and leaves a plain activate uncoloured', () => {
    const events: DiagramEvent[] = [
      { kind: 'activate', id: 'a1', participantId: 'api', colour: '#c026d3' },
      { kind: 'message', id: 'm', from: 'api', to: 'db', label: 'read', type: 'SYNCHRONOUS' },
      { kind: 'deactivate', id: 'd1', participantId: 'api' },
      { kind: 'activate', id: 'a2', participantId: 'db' },
      { kind: 'deactivate', id: 'd2', participantId: 'db' },
    ]
    const spans = activationSpans(layoutRows(events), 400)
    expect(spans.map((s) => s.colour)).toEqual(['#c026d3', undefined])
  })
})
