import { describe, expect, it } from 'vitest'
import type { DiagramEvent } from '../types'
import { MESSAGE_LABEL_RISE, ROW_H, TOP_LABEL_PAD, layoutRows } from './layout'
import { messageLabelRect } from './diagram-view'
import {
  circleClearsCenter,
  diagramKeyAction,
  drawnFocusTarget,
  focusScrollTop,
  focusTargetAfterClose,
  hitBoxContains,
  messageHitBox,
  messagePlaces,
  MIN_HIT_CSS,
  replacementFocus,
  scrollPaddingTop,
  sidewaysScrollLeft,
  tabindexFor,
  TOUCH_HIT_CSS,
} from './diagram-a11y'

const events: DiagramEvent[] = [
  {
    kind: 'message',
    id: 'm1',
    from: 'a',
    to: 'b',
    label: 'place order',
    type: 'SYNCHRONOUS',
    data: { method: 'POST' },
  },
  { kind: 'note', id: 'n1', text: 'wait', placement: 'over' },
  { kind: 'message', id: 'm2', from: 'b', to: 'a', label: 'ack', type: 'SYNCHRONOUS_RESPONSE' },
  { kind: 'message', id: 'm3', from: 'a', to: 'b', label: 'charge', type: 'SYNCHRONOUS', data: { path: '/pay' } },
]

describe('diagram keyboard', () => {
  const places = messagePlaces(events, new Set())

  it('moves from the tab stop to the next focusable message', () => {
    const down = diagramKeyAction({ key: 'ArrowDown', places, activeId: 'm1', inDiagram: true })
    expect(down).toEqual({ type: 'move', messageId: 'm3' })
    const up = diagramKeyAction({ key: 'ArrowUp', places, activeId: 'm3', inDiagram: true })
    expect(up).toEqual({ type: 'move', messageId: 'm1' })
  })

  it('enters the diagram on the first message when nothing is active yet', () => {
    expect(diagramKeyAction({ key: 'ArrowDown', places, activeId: null, inDiagram: true })).toEqual({
      type: 'move',
      messageId: 'm1',
    })
    expect(diagramKeyAction({ key: 'Enter', places, activeId: null, inDiagram: true })).toEqual({
      type: 'open',
      messageId: 'm1',
    })
  })

  it('Enter and Space open the active message, and close returns to that arrow', () => {
    const opened = diagramKeyAction({ key: 'Enter', places, activeId: 'm3', inDiagram: true })
    expect(opened).toEqual({ type: 'open', messageId: 'm3' })
    expect(diagramKeyAction({ key: ' ', places, activeId: 'm3', inDiagram: true })).toEqual({
      type: 'open',
      messageId: 'm3',
    })
    expect(focusTargetAfterClose('m3')).toBe('m3')
    expect(focusTargetAfterClose(null)).toBeNull()
  })

  it('keeps a single tab stop and ignores arrows that are not in the diagram', () => {
    expect(tabindexFor('m1', null, places)).toBe(0)
    expect(tabindexFor('m3', null, places)).toBe(-1)
    expect(tabindexFor('m2', 'm1', places)).toBe(-1)
    expect(tabindexFor('m3', 'm3', places)).toBe(0)
    expect(tabindexFor('m1', 'm3', places)).toBe(-1)
    expect(diagramKeyAction({ key: 'ArrowDown', places, activeId: 'm1', inDiagram: false })).toEqual({
      type: 'noop',
    })
  })

  it('moves focus to the logical next message when the focused row is unmounted', () => {
    expect(replacementFocus('m1', places, new Set(['m3']))).toBe('m3')
    expect(replacementFocus('m1', places, new Set(['m1', 'm3']))).toBe('m1')
    expect(replacementFocus('m3', places, new Set())).toBe('m3')
  })
})

describe('focus for a message whose lane is hidden', () => {
  const lanes: DiagramEvent[] = [
    { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'one', type: 'SYNCHRONOUS', data: 1 },
    { kind: 'message', id: 'm2', from: 'a', to: 'c', label: 'two', type: 'SYNCHRONOUS', data: 2 },
    { kind: 'message', id: 'm3', from: 'b', to: 'a', label: 'three', type: 'SYNCHRONOUS' },
    { kind: 'message', id: 'm4', from: 'b', to: 'a', label: 'four', type: 'SYNCHRONOUS', data: 4 },
  ]

  it('keeps a drawn, focusable message', () => {
    expect(drawnFocusTarget(lanes, new Set(), 'm2')).toBe('m2')
  })

  it('moves to the next drawn arrow that can take focus, else the previous one', () => {
    expect(drawnFocusTarget(lanes, new Set(['c']), 'm2')).toBe('m4')
    expect(drawnFocusTarget(lanes, new Set(['b']), 'm4')).toBe('m2')
  })

  it('gives null when no drawn arrow can take focus, or the message is unknown', () => {
    expect(drawnFocusTarget(lanes, new Set(['a']), 'm1')).toBeNull()
    expect(drawnFocusTarget(lanes, new Set(), 'gone')).toBeNull()
  })
})

describe('message position', () => {
  it('sets posinset and setsize from the full message list, not the painted rows', () => {
    const places = messagePlaces(events, new Set())
    expect(places.map((place) => [place.id, place.posinset, place.setsize, place.focusable])).toEqual([
      ['m1', 1, 3, true],
      ['m2', 2, 3, false],
      ['m3', 3, 3, true],
    ])
    const paintedSlice = places.slice(2, 3)
    expect(paintedSlice[0].setsize).toBe(3)
    expect(paintedSlice[0].setsize).not.toBe(paintedSlice.length)
  })
})

describe('arrow hit box', () => {
  it('is at least 24 CSS pixels at normal zoom and does not cover the next arrow centre', () => {
    const arrowY = TOP_LABEL_PAD
    const nextY = arrowY + ROW_H.message
    const label = messageLabelRect({ arrowY, x1: 72, x2: 212 })
    const box = messageHitBox({ label, zoom: 1, viewTop: 0, nextArrowY: nextY })
    expect(box.width).toBeGreaterThanOrEqual(MIN_HIT_CSS)
    expect(box.height).toBeGreaterThanOrEqual(MIN_HIT_CSS)
    expect(hitBoxContains(box, (72 + 212) / 2, arrowY)).toBe(true)
    expect(hitBoxContains(box, (72 + 212) / 2, nextY)).toBe(false)
    expect(box.top + box.height).toBeLessThanOrEqual((arrowY + nextY) / 2)
  })

  it('grows to 44px on touch where the rows allow, and still stops at the neighbours', () => {
    const arrowY = 200
    const label = { x: 10, y: arrowY - MESSAGE_LABEL_RISE, width: 8, height: MESSAGE_LABEL_RISE }
    const roomy = messageHitBox({
      label,
      zoom: 1,
      viewTop: 0,
      prevArrowY: 100,
      nextArrowY: 300,
      minSize: TOUCH_HIT_CSS,
    })
    expect(roomy.width).toBeGreaterThanOrEqual(TOUCH_HIT_CSS)
    expect(roomy.height).toBeGreaterThanOrEqual(TOUCH_HIT_CSS)
    const tight = messageHitBox({
      label,
      zoom: 1,
      viewTop: 0,
      prevArrowY: 180,
      nextArrowY: 220,
      minSize: TOUCH_HIT_CSS,
    })
    expect(tight.top).toBeGreaterThanOrEqual(190)
    expect(tight.top + tight.height).toBeLessThanOrEqual(210)
    expect(tight.width).toBeGreaterThanOrEqual(TOUCH_HIT_CSS)
  })

  it('keeps a short row on the spacing exception instead of swallowing the neighbour', () => {
    const arrowY = 100
    const prevY = arrowY - ROW_H.message
    const nextY = arrowY + ROW_H.message
    const zoom = 0.25
    const box = messageHitBox({
      label: { x: 10, y: arrowY - MESSAGE_LABEL_RISE, width: 8, height: MESSAGE_LABEL_RISE },
      zoom,
      viewTop: 0,
      prevArrowY: prevY,
      nextArrowY: nextY,
    })
    const cy = arrowY * zoom
    const cx = (10 + 4) * zoom
    expect(circleClearsCenter(cy, nextY * zoom)).toBe(true)
    expect(circleClearsCenter(cy, prevY * zoom)).toBe(true)
    expect(hitBoxContains(box, cx, cy)).toBe(true)
    expect(hitBoxContains(box, cx, nextY * zoom)).toBe(false)
    expect(box.width).toBeGreaterThanOrEqual(MIN_HIT_CSS)
  })
})

describe('focus scroll keeps the top label', () => {
  it('scrolls to the label above the arrow, which the first row already insets', () => {
    const rows = layoutRows([
      { kind: 'message', id: 'm', from: 'a', to: 'b', label: 'place order', type: 'SYNCHRONOUS' },
    ])
    expect(rows[0].y).toBe(TOP_LABEL_PAD)
    expect(TOP_LABEL_PAD).toBeGreaterThan(MESSAGE_LABEL_RISE)
    const top = focusScrollTop(rows[0].y, 1)
    expect(top).toBe(TOP_LABEL_PAD - MESSAGE_LABEL_RISE)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top).toBeLessThan(rows[0].y)
  })

  it('pads focus by the sticky header and scales with zoom', () => {
    expect(scrollPaddingTop(56)).toBe(56)
    expect(scrollPaddingTop(-4)).toBe(0)
    expect(focusScrollTop(TOP_LABEL_PAD + 520, 2)).toBe((TOP_LABEL_PAD + 520 - MESSAGE_LABEL_RISE) * 2)
  })
})

describe('reduced motion and payload places', () => {
  it('treats a deferred payload id as focusable when the body is not on the message', () => {
    const deferred: DiagramEvent[] = [
      { kind: 'message', id: 'm', from: 'a', to: 'b', label: 'place order', type: 'SYNCHRONOUS', payloadId: 's/m' },
    ]
    expect(messagePlaces(deferred, new Set())[0].focusable).toBe(true)
  })
})

describe('sidewaysScrollLeft (#65)', () => {
  const key = (k: string, shiftKey = false, extra: Partial<KeyboardEvent> = {}) => ({
    key: k,
    shiftKey,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  })
  const wide = { scrollLeft: 100, clientWidth: 1000, scrollWidth: 5000 }

  it('scrolls a screen less 48px with Shift+arrows, clamped to the edges', () => {
    expect(sidewaysScrollLeft(key('ArrowRight', true), wide)).toBe(1052)
    expect(sidewaysScrollLeft(key('ArrowLeft', true), wide)).toBe(0)
    expect(sidewaysScrollLeft(key('ArrowRight', true), { ...wide, scrollLeft: 3900 })).toBe(4000)
  })

  it('goes to the edges with Home and End, and leaves them to the page at that edge already', () => {
    expect(sidewaysScrollLeft(key('Home'), wide)).toBe(0)
    expect(sidewaysScrollLeft(key('End'), wide)).toBe(4000)
    expect(sidewaysScrollLeft(key('Home'), { ...wide, scrollLeft: 0 })).toBeNull()
    expect(sidewaysScrollLeft(key('End'), { ...wide, scrollLeft: 4000 })).toBeNull()
  })

  it('leaves other keys, modified keys and a diagram that fits alone', () => {
    expect(sidewaysScrollLeft(key('ArrowRight'), wide)).toBeNull()
    expect(sidewaysScrollLeft(key('ArrowDown', true), wide)).toBeNull()
    expect(sidewaysScrollLeft(key('End', false, { ctrlKey: true }), wide)).toBeNull()
    expect(sidewaysScrollLeft(key('Home', true), wide)).toBeNull()
    expect(sidewaysScrollLeft(key('End'), { scrollLeft: 0, clientWidth: 900, scrollWidth: 900 })).toBeNull()
  })
})
