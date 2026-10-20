import { describe, expect, it } from 'vitest'
import type { DiagramEvent, Participant } from '../types'
import { COL_GAP, LEFT_PAD, MESSAGE_LABEL_RISE, bodyHeight, diagramWidth, layoutRows } from './layout'
import { sliceViewTop } from './sequence-diagram'
import {
  eventHiddenByColumns,
  fitToWidthScale,
  fittedView,
  matchingEventIds,
  messageLabelRect,
  rectContains,
  rowMatchesQuery,
  findMatch,
  searchCountLabel,
  stepZoom,
  unscaledViewport,
  visibleColumnIds,
  settleFitWidth,
  ZOOM_LEVELS,
  MAX_ZOOM,
  MIN_ZOOM,
  OVERVIEW_MIN_ZOOM,
  canStepZoom,
  lanesInView,
  overviewNeeded,
  overviewScale,
  zoomAnnouncement,
  zoomLabel,
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

describe('fitted view includes the top message label', () => {
  const message: DiagramEvent = {
    kind: 'message',
    id: 'm',
    from: 'a',
    to: 'b',
    label: 'place order',
    type: 'SYNCHRONOUS',
  }

  it('keeps the label box inside the viewBox and the fitted rect when the diagram is scaled down', () => {
    const rows = layoutRows([message])
    const arrowY = rows[0].y
    const label = messageLabelRect({ arrowY, x1: LEFT_PAD, x2: LEFT_PAD + COL_GAP })
    expect(label.y).toBe(arrowY - MESSAGE_LABEL_RISE)
    expect(label.y).toBeGreaterThanOrEqual(0)
    expect(sliceViewTop(arrowY)).toBeLessThanOrEqual(label.y)

    const view = fittedView({
      contentWidth: 1400,
      viewportWidth: 640,
      viewportHeight: 480,
      mustInclude: label,
    })
    expect(view.scale).toBeLessThan(1)
    expect(view.originX).toBeGreaterThanOrEqual(0)
    expect(view.originY).toBeGreaterThanOrEqual(0)
    expect(rectContains(view.visible, label)).toBe(true)
    expect(view.visible.y).toBeLessThanOrEqual(label.y)
    expect(view.visible.y + view.visible.height).toBeGreaterThanOrEqual(label.y + label.height)
  })

  it('still includes the label on a diagram that already fits the viewport', () => {
    const rows = layoutRows([message])
    const label = messageLabelRect({ arrowY: rows[0].y, x1: LEFT_PAD, x2: LEFT_PAD + COL_GAP })
    const width = diagramWidth(2)
    const view = fittedView({
      contentWidth: width,
      viewportWidth: width + 80,
      viewportHeight: 360,
      mustInclude: label,
    })
    expect(view.scale).toBeGreaterThanOrEqual(1)
    expect(rectContains(view.visible, label)).toBe(true)
    expect(bodyHeight(rows)).toBeGreaterThan(label.y + label.height)
  })

  it('does not treat a label above the content origin as visible when the view is pinned at 0', () => {
    const clipped = messageLabelRect({ arrowY: 0, x1: 72, x2: 212 })
    expect(clipped.y).toBeLessThan(0)
    expect(rectContains({ x: 0, y: 0, width: 500, height: 400 }, clipped)).toBe(false)
  })
})

describe('zoom steps (#94)', () => {
  it('steps along the preset ladder, from 25% to 250%', () => {
    expect(ZOOM_LEVELS).toEqual([0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5])
    expect(ZOOM_LEVELS[0]).toBe(MIN_ZOOM)
    expect(ZOOM_LEVELS.at(-1)).toBe(MAX_ZOOM)
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(1.25, 1)).toBe(1.5)
  })

  it('snaps from a level off the ladder to the nearest preset that way: 95% + gives 100%', () => {
    expect(stepZoom(0.95, 1)).toBe(1)
    expect(stepZoom(0.95, -1)).toBe(0.9)
    // An overview scale.
    expect(stepZoom(0.48, 1)).toBe(0.5)
    expect(stepZoom(0.48, -1)).toBe(0.33)
    expect(stepZoom(OVERVIEW_MIN_ZOOM, 1)).toBe(0.25)
  })

  it('stops at exactly 250% and 25%, and says so', () => {
    let up = 0.95
    for (let i = 0; i < 30; i++) up = stepZoom(up, 1)
    expect(up).toBe(2.5)
    let down = 0.95
    for (let i = 0; i < 30; i++) down = stepZoom(down, -1)
    expect(down).toBe(0.25)
    expect(canStepZoom(2.5, 1)).toBe(false)
    expect(canStepZoom(0.25, -1)).toBe(false)
    expect(canStepZoom(OVERVIEW_MIN_ZOOM, -1)).toBe(false)
    expect(canStepZoom(0.95, 1)).toBe(true)
  })

  it('treats a level within half a point of a preset as that preset', () => {
    expect(stepZoom(0.9999, 1)).toBe(1.1)
    expect(stepZoom(1.0001, -1)).toBe(0.9)
  })
})

describe('Overview (#94)', () => {
  it('fits the whole width, down to 10% and never above 100%', () => {
    expect(overviewScale(2000, 1000)).toBe(0.5)
    expect(overviewScale(100_000, 1000)).toBe(OVERVIEW_MIN_ZOOM)
    expect(overviewScale(400, 1000)).toBe(1)
    expect(overviewScale(0, 1000)).toBe(1)
    expect(overviewScale(1000, 0)).toBe(1)
  })

  it('has nothing to show when the default view (never below 95%) already shows the whole width', () => {
    expect(overviewNeeded(1000, 1000)).toBe(false)
    expect(overviewNeeded(1050, 1000)).toBe(false)
    expect(overviewNeeded(1100, 1000)).toBe(true)
    expect(overviewNeeded(1100, 0)).toBe(false)
  })

  it('counts the lanes whose lifeline is in view', () => {
    expect(lanesInView([10, 150, 290, 430], 0, 300)).toBe(3)
    expect(lanesInView([10, 150, 290, 430], 140, 300)).toBe(3)
    expect(lanesInView([10, 150, 290, 430], 0, 1000)).toBe(4)
  })

  it('reads its level down to 10%', () => {
    expect(zoomLabel(0.1)).toBe('10%')
    expect(zoomLabel(0.05)).toBe('10%')
    expect(zoomLabel(0.476)).toBe('48%')
  })
})

describe('zoom announcements (#94)', () => {
  it('says what changed, with its context', () => {
    expect(zoomAnnouncement({ kind: 'step', zoom: 1.1 })).toBe('Zoom 110%')
    expect(zoomAnnouncement({ kind: 'default', zoom: 0.95 })).toBe('Default zoom, 95%')
    expect(zoomAnnouncement({ kind: 'overview', zoom: 0.48, shown: 14, total: 14 })).toBe(
      'Overview, 48%, whole diagram',
    )
    expect(zoomAnnouncement({ kind: 'overview', zoom: 0.1, shown: 72, total: 100 })).toBe(
      'Overview, 10%, 72 of 100 lanes shown',
    )
    expect(zoomAnnouncement({ kind: 'overview-off', zoom: 0.95 })).toBe('Overview off, zoom 95%')
  })
})

describe('unscaledViewport', () => {
  it('divides scroll, viewport, and sticky header by zoom', () => {
    expect(unscaledViewport({ scrollTop: 100, viewportHeight: 200, headerHeight: 40, zoom: 2 })).toEqual({
      scrollTop: 50,
      viewportHeight: 100,
      headerHeight: 20,
    })
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

describe('findMatch', () => {
  it('says whether the label, the payload or both matched', () => {
    const hits = new Set([events[0].id])
    expect(findMatch(events[0], 'read', hits)).toBe('both')
    expect(findMatch(events[0], 'zzz', hits)).toBe('payload')
    expect(findMatch(events[0], 'read')).toBe('label')
    expect(findMatch(events[0], 'zzz')).toBeNull()
    // A note has no payload.
    expect(findMatch(events[3], 'zzz', new Set([events[3].id]))).toBeNull()
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

  it('lists matching ids and words the count', () => {
    expect(matchingEventIds(events, 'read')).toEqual(['m1'])
    expect(searchCountLabel(2, 1, 'c')).toBe('2 matches, 1 on a hidden column')
    expect(searchCountLabel(1, 0, 'read')).toBe('1 match')
    expect(searchCountLabel(5, 0, 'c', 2)).toBe('2 of 5')
    expect(searchCountLabel(5, 1, 'c', 4)).toBe('4 of 4, 1 on a hidden column')
    expect(searchCountLabel(5, 0, '', 2)).toBe('')
    expect(searchCountLabel(0, 0, '   ')).toBe('')
    expect(searchCountLabel(5, 1, 'c', 2, { inPayloads: 3 })).toBe('2 of 4, 3 in payloads, 1 on a hidden column')
    expect(searchCountLabel(2, 0, 'c', 0, { pending: true })).toBe('2 matches, searching payloads…')
    expect(searchCountLabel(0, 0, 'c', 0, { pending: true })).toBe('Searching payloads…')
    expect(searchCountLabel(0, 0, 'c', 0, { failed: true })).toBe('0 matches, payloads could not be loaded')
  })
})

describe('settleFitWidth', () => {
  // Scrollport 948px wide; a 15px vertical scrollbar shows once the fitted drawing
  // is taller than the stage, which happens when fitting to more than `tall` px.
  function scrollport(tall: number) {
    const calls: number[] = []
    const applyAt = (width: number) => {
      calls.push(width)
      return width > tall ? 933 : 948
    }
    return { calls, applyAt }
  }

  it('keeps the width when zooming does not change the scrollbar', () => {
    const port = scrollport(10_000)
    expect(settleFitWidth(948, port.applyAt)).toBe(948)
    expect(port.calls).toEqual([948])
  })

  it('refits to the narrower width when zooming in adds a vertical scrollbar', () => {
    const port = scrollport(0)
    expect(settleFitWidth(948, port.applyAt)).toBe(933)
    expect(port.calls.at(-1)).toBe(933)
  })

  it('uses the room a scrollbar leaves when zooming out removes it', () => {
    const port = scrollport(10_000)
    // Started with a scrollbar (933); after the fit it is gone (948 free).
    expect(settleFitWidth(933, port.applyAt)).toBe(948)
    expect(port.calls.at(-1)).toBe(948)
  })

  it('settles on the narrower width when the wider fit would bring the scrollbar back', () => {
    const port = scrollport(940)
    expect(settleFitWidth(948, port.applyAt)).toBe(933)
    expect(port.calls.at(-1)).toBe(933)
    expect(port.calls.length).toBeLessThanOrEqual(4)
  })
})
