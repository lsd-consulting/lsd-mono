import { describe, expect, it } from 'vitest'
import type { DiagramEvent } from '../types'
import { MESSAGE_LABEL_RISE, NOTE_CARD_MIN_H, NOTE_CARD_W, NOTE_ROW_GAP, ROW_H, SECTION_AFTER_PAD, SECTION_BAND_H, SECTION_BAND_Y, SECTION_LABEL_GAP, TOP_LABEL_PAD, activationSpans, eventRowHeight, layoutRows, noteCardMetrics, sortEventsByCreatedAt, virtualRowRange, wrapNoteLines } from './layout'

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

  it('keeps a short note on the default row height', () => {
    expect(eventRowHeight({ kind: 'note', id: 'n', text: 'ok', placement: 'over' })).toBe(ROW_H.note)
  })

  it('grows the row when a wrapped note card is taller than the default', () => {
    const text =
      'This note is long enough that it must wrap across several lines inside the fixed-width card'
    const card = noteCardMetrics(text)
    expect(card.lines.length).toBeGreaterThan(1)
    expect(card.height).toBeGreaterThan(NOTE_CARD_MIN_H)
    expect(eventRowHeight({ kind: 'note', id: 'n', text, placement: 'over' })).toBe(
      card.height + NOTE_ROW_GAP,
    )
  })
})

describe('wrapNoteLines', () => {
  it('keeps short copy on one line', () => {
    expect(wrapNoteLines('cache miss')).toEqual(['cache miss'])
  })

  it('wraps long copy and hard-splits an overlong token', () => {
    const lines = wrapNoteLines('alpha bravo charlie delta echosupercalifragilistic')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toContain('echosupercalifragilistic')
    expect(lines.some((line) => line.length > Math.floor((NOTE_CARD_W - 20) / 6))).toBe(false)
  })
})

describe('noteCardMetrics', () => {
  it('keeps the 140×28 card for a single short line', () => {
    const card = noteCardMetrics('hi')
    expect(card.width).toBe(NOTE_CARD_W)
    expect(card.height).toBe(NOTE_CARD_MIN_H)
    expect(card.lines).toEqual(['hi'])
  })

  it('grows height with each wrapped line while width stays fixed', () => {
    const short = noteCardMetrics('short')
    const long = noteCardMetrics(
      'one two three four five six seven eight nine ten eleven twelve',
    )
    expect(long.lines.length).toBeGreaterThan(short.lines.length)
    expect(long.width).toBe(NOTE_CARD_W)
    expect(long.height).toBeGreaterThan(short.height)
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

describe('section spacing', () => {
  it('keeps the following message label clear of the section band', () => {
    const rows = layoutRows([
      { kind: 'section', id: 's', title: 'Phase 2' },
      { kind: 'message', id: 'm', from: 'a', to: 'b', label: 'place order', type: 'SYNCHRONOUS' },
    ])
    const section = rows[0]
    const message = rows[1]
    expect(section.height).toBe(ROW_H.section)
    expect(ROW_H.section).toBe(SECTION_BAND_Y + SECTION_BAND_H + SECTION_AFTER_PAD)
    const bandBottom = section.y + SECTION_BAND_Y + SECTION_BAND_H
    const labelTop = message.y - MESSAGE_LABEL_RISE
    expect(labelTop - bandBottom).toBe(SECTION_LABEL_GAP)
    expect(labelTop).toBeGreaterThan(bandBottom)
  })

  it('still clears the label when an activation marker sits between the section and the message', () => {
    const rows = layoutRows([
      { kind: 'section', id: 's', title: 'Phase 2' },
      { kind: 'activate', id: 'a', participantId: 'b' },
      { kind: 'message', id: 'm', from: 'a', to: 'b', label: 'place order', type: 'SYNCHRONOUS' },
    ])
    const section = rows[0]
    const message = rows[2]
    const bandBottom = section.y + SECTION_BAND_Y + SECTION_BAND_H
    expect(message.y - MESSAGE_LABEL_RISE).toBeGreaterThan(bandBottom)
  })

  it('grows the section row when the next note rises higher than a message label', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen'
    const card = noteCardMetrics(text)
    expect(card.height / 2).toBeGreaterThan(SECTION_AFTER_PAD)
    const rows = layoutRows([
      { kind: 'section', id: 's', title: 'Phase 2' },
      { kind: 'note', id: 'n', text, placement: 'over' },
    ])
    const bandBottom = rows[0].y + SECTION_BAND_Y + SECTION_BAND_H
    const cardTop = rows[1].y - card.height / 2
    expect(rows[0].height).toBeGreaterThan(ROW_H.section)
    expect(cardTop - bandBottom).toBe(SECTION_LABEL_GAP)
  })
})
