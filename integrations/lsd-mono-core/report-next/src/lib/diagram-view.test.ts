import { describe, expect, it } from 'vitest'
import type { DiagramEvent, Participant } from '../types'
import {
  classifySearchHits,
  eventHiddenByColumns,
  fitToWidthScale,
  matchingEventIds,
  rowMatchesQuery,
  searchCountLabel,
  stepZoom,
  unscaledViewport,
  visibleColumnIds,
  zoomFromWheel,
} from './diagram-view'

const participants: Participant[] = [
  { id: 'a', name: 'A', type: 'PARTICIPANT' },
  { id: 'b', name: 'B', type: 'PARTICIPANT' },
  { id: 'c', name: 'C', type: 'DATABASE' },
]

const events: DiagramEvent[] = [
  { kind: 'message', id: 'm1', from: 'a', to: 'c', label: 'Read rows', type: 'SYNCHRONOUS' },
  { kind: 'message', id: 'm2', from: 'b', to: 'c', label: 'Write', type: 'ASYNCHRONOUS' },
  { kind: 'message', id: 'm3', from: 'a', to: '', label: 'emit', type: 'SHORT_OUTBOUND' },
  { kind: 'note', id: 'n1', text: 'cache miss', over: 'b', placement: 'over' },
  { kind: 'note', id: 'n2', text: 'wide note', placement: 'left' },
  { kind: 'divider', id: 'd1', label: 'Read rows' },
]

describe('fitToWidthScale', () => {
  it('divides viewport width by content width', () => {
    expect(fitToWidthScale(1000, 500)).toBe(0.5)
  })

  it('clamps to the zoom range', () => {
    expect(fitToWidthScale(100, 1000)).toBe(2.5)
    expect(fitToWidthScale(4000, 100)).toBe(0.25)
  })

  it('stays at 1 when the scrollport has not been measured', () => {
    expect(fitToWidthScale(800, 0)).toBe(1)
    expect(fitToWidthScale(0, 400)).toBe(1)
  })
})

describe('zoom steps', () => {
  it('zooms out on a positive wheel delta and in on a negative one', () => {
    expect(zoomFromWheel(1, 120)).toBe(0.9)
    expect(zoomFromWheel(1, -1)).toBe(1.1)
    expect(zoomFromWheel(1, 0)).toBe(1)
  })

  it('clamps button steps', () => {
    expect(stepZoom(2.5, 1)).toBe(2.5)
    expect(stepZoom(0.25, -1)).toBe(0.25)
  })
})

describe('unscaledViewport', () => {
  it('divides scroll, viewport, and sticky header by zoom', () => {
    expect(
      unscaledViewport({ scrollTop: 100, viewportHeight: 200, headerHeight: 40, zoom: 2 }),
    ).toEqual({ scrollTop: 50, viewportHeight: 100, headerHeight: 20 })
  })
})

describe('visibleColumnIds', () => {
  it('drops hidden participants and keeps the remaining order', () => {
    expect(visibleColumnIds(participants, new Set(['b']))).toEqual(['a', 'c'])
    expect(visibleColumnIds(participants, new Set())).toEqual(['a', 'b', 'c'])
  })
})

describe('eventHiddenByColumns', () => {
  it('omits a message that names a hidden participant and keeps one that does not', () => {
    const hidden = new Set(['b'])
    expect(eventHiddenByColumns(events[0], hidden)).toBe(false)
    expect(eventHiddenByColumns(events[1], hidden)).toBe(true)
  })

  it('hides a short arrow only when its real endpoint is hidden', () => {
    expect(eventHiddenByColumns(events[2], new Set(['b']))).toBe(false)
    expect(eventHiddenByColumns(events[2], new Set(['a']))).toBe(true)
  })

  it('hides an anchored note and keeps an unanchored one', () => {
    const hidden = new Set(['b'])
    expect(eventHiddenByColumns(events[3], hidden)).toBe(true)
    expect(eventHiddenByColumns(events[4], hidden)).toBe(false)
    expect(eventHiddenByColumns(events[5], hidden)).toBe(false)
  })
})

describe('rowMatchesQuery', () => {
  it('matches message labels and note text, case-insensitively, and nothing else', () => {
    expect(rowMatchesQuery(events[0], 'read')).toBe(true)
    expect(rowMatchesQuery(events[0], 'WRITE')).toBe(false)
    expect(rowMatchesQuery(events[3], 'Cache')).toBe(true)
    expect(rowMatchesQuery(events[5], 'read')).toBe(false)
    expect(rowMatchesQuery(events[0], '   ')).toBe(false)
  })

  it('lists matching ids and counts hits that sit on a hidden column', () => {
    expect(matchingEventIds(events, 'read')).toEqual(['m1'])
    expect(classifySearchHits(events, 'cache', new Set(['b']))).toEqual({ total: 1, hidden: 1 })
    expect(classifySearchHits(events, 'read', new Set(['b']))).toEqual({ total: 1, hidden: 0 })
    expect(searchCountLabel(2, 1, 'c')).toBe('2 matches, 1 on a hidden column')
    expect(searchCountLabel(1, 0, 'read')).toBe('1 match')
    expect(searchCountLabel(0, 0, '   ')).toBe('')
  })
})
