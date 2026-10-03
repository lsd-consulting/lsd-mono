import { describe, expect, it } from 'vitest'
import type { LayoutRow } from './layout'
import { LEFT_PAD, SHORT_STUB, layoutRows } from './layout'
import {
  activationBarSvg,
  arrowMarker,
  messageArrowSpec,
  noteLayout,
  renderRowSvg,
  shortMessageEndpoints,
} from './sequence-diagram'
import type { DiagramEvent, Participant } from '../types'

const participants: Participant[] = [
  { id: 'api', name: 'Api', type: 'PARTICIPANT', colour: '#34d399' },
  { id: 'db', name: 'Db', type: 'DATABASE', colour: '#94a3b8' },
]

function rowFor(event: DiagramEvent): LayoutRow {
  return layoutRows([event])[0]
}

describe('messageArrowSpec', () => {
  it('gives LOST an X tip and a text cue (not colour-only)', () => {
    expect(messageArrowSpec('LOST')).toEqual({
      dashed: false,
      start: 'none',
      end: 'lost',
      typeCue: 'lost',
    })
  })

  it('gives BI_DIRECTIONAL dual filled heads and a cue', () => {
    expect(messageArrowSpec('BI_DIRECTIONAL')).toEqual({
      dashed: false,
      start: 'filled',
      end: 'filled',
      typeCue: '↔',
    })
  })
})

describe('arrowMarker', () => {
  it('draws an X path for lost tips', () => {
    const svg = arrowMarker('mk_lost', '#34d399', 'lost')
    expect(svg).toContain('M2 2 L10 10')
    expect(svg).toContain('M10 2 L2 10')
    expect(svg).not.toContain('L10 5 L0 10 z')
  })

  it('draws a filled triangle for sync tips', () => {
    const svg = arrowMarker('mk_f', '#34d399', 'filled')
    expect(svg).toContain('L10 5 L0 10 z')
  })
})

describe('shortMessageEndpoints', () => {
  it('draws SHORT_INBOUND from a stub left of the lifeline to the participant', () => {
    const px = LEFT_PAD
    const { x1, x2 } = shortMessageEndpoints('SHORT_INBOUND', px, 400)
    expect(x2).toBeLessThan(px)
    expect(x1).toBeLessThan(x2)
    expect(x2 - x1).toBeLessThanOrEqual(SHORT_STUB)
  })

  it('draws SHORT_OUTBOUND from the lifeline toward the right edge', () => {
    const px = LEFT_PAD
    const { x1, x2 } = shortMessageEndpoints('SHORT_OUTBOUND', px, 400)
    expect(x1).toBeGreaterThan(px)
    expect(x2).toBeGreaterThan(x1)
    expect(x2 - x1).toBeLessThanOrEqual(SHORT_STUB)
  })
})

describe('noteLayout', () => {
  const index = new Map([
    ['api', 0],
    ['db', 1],
  ])

  it('places over notes on the anchor lifeline', () => {
    const layout = noteLayout('over', 'api', index, 400)
    expect(layout.placement).toBe('over')
    expect(layout.x).toBe(LEFT_PAD)
  })

  it('offsets left notes left of the anchor', () => {
    const over = noteLayout('over', 'api', index, 400)
    const left = noteLayout('left', 'api', index, 400)
    expect(left.placement).toBe('left')
    expect(left.x).toBeLessThan(over.x)
  })

  it('offsets right notes right of the anchor', () => {
    const over = noteLayout('over', 'api', index, 400)
    const right = noteLayout('right', 'api', index, 400)
    expect(right.placement).toBe('right')
    expect(right.x).toBeGreaterThan(over.x)
  })
})

describe('renderRowSvg fragments', () => {
  it('draws a real button with an accessible name when the arrow has backing data', () => {
    const html = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-data',
        from: 'api',
        to: 'db',
        label: 'place order',
        type: 'SYNCHRONOUS',
        data: {
          method: 'POST',
          path: '/orders',
          status: 201,
          headers: { 'content-type': 'application/json' },
          body: { orderId: 'ord_1' },
        },
      }),
      400,
      participants,
    )
    expect(html).toContain('<button type="button" class="msg-open"')
    expect(html).toContain('aria-label="Open place order"')
    expect(html).toContain('data-message-id="m-data"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('role="button"')
  })

  it('does not add an arrow button when there is no payload', () => {
    const html = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-empty',
        from: 'api',
        to: 'db',
        label: 'ping',
        type: 'SYNCHRONOUS',
      }),
      400,
      participants,
    )
    expect(html).not.toContain('msg-open')
  })

  it('includes lost X marker and type cue for LOST messages', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-lost',
        from: 'api',
        to: 'db',
        label: 'drop',
        type: 'LOST',
      }),
      400,
      participants,
    )
    expect(svg).toContain('data-msg-type="LOST"')
    expect(svg).toContain('[lost]')
    expect(svg).toContain('M2 2 L10 10')
  })

  it('includes marker-start and marker-end for BI_DIRECTIONAL', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-bi',
        from: 'api',
        to: 'db',
        label: 'sync',
        type: 'BI_DIRECTIONAL',
      }),
      400,
      participants,
    )
    expect(svg).toContain('data-msg-type="BI_DIRECTIONAL"')
    expect(svg).toContain('marker-start=')
    expect(svg).toContain('marker-end=')
    expect(svg).toContain('[↔]')
  })

  it('renders short inbound/outbound without inventing a second participant', () => {
    const inbound = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-in',
        from: '',
        to: 'api',
        label: 'found',
        type: 'SHORT_INBOUND',
      }),
      400,
      participants,
    )
    expect(inbound).toContain('data-msg-type="SHORT_INBOUND"')
    expect(inbound).toContain('[in]')
    expect(inbound).toContain('message-short')

    const outbound = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-out',
        from: 'api',
        to: '',
        label: 'emit',
        type: 'SHORT_OUTBOUND',
      }),
      400,
      participants,
    )
    expect(outbound).toContain('data-msg-type="SHORT_OUTBOUND"')
    expect(outbound).toContain('[out]')
  })

  it('truncates long labels to the configured width and keeps the full text in the title', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-long',
        from: 'api',
        to: 'db',
        label: 'abcdefghijklmnopqrstuvwxyz',
        type: 'SYNCHRONOUS',
      }),
      400,
      participants,
      12,
    )
    expect(svg).toContain('<title>abcdefghijklmnopqrstuvwxyz</title>abcdefghi...')
    expect(svg).not.toContain('>abcdefghijklmnopqrstuvwxyz</text>')
  })

  it('marks left and right note placement in the SVG', () => {
    const left = renderRowSvg(
      rowFor({ kind: 'note', id: 'n1', text: 'L', over: 'api', placement: 'left' }),
      400,
      participants,
    )
    expect(left).toContain('data-placement="left"')
    expect(left).toContain('note-left')

    const right = renderRowSvg(
      rowFor({ kind: 'note', id: 'n2', text: 'R', over: 'api', placement: 'right' }),
      400,
      participants,
    )
    expect(right).toContain('data-placement="right"')
    expect(right).toContain('note-right')
  })
})

describe('diagram view paint', () => {
  const three: Participant[] = [
    ...participants,
    { id: 'queue', name: 'Queue', type: 'QUEUE' },
  ]

  it('shifts the next column left when a participant is hidden', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-q',
        from: 'api',
        to: 'queue',
        label: 'enqueue',
        type: 'SYNCHRONOUS',
      }),
      800,
      three,
      200,
      { query: '', hiddenIds: new Set(['db']) },
    )
    // api stays at column 0; queue moves from column 2 to column 1.
    expect(svg).toContain('x2="206"')
    expect(svg).not.toContain('x2="346"')
  })

  it('omits a message that needs a hidden participant', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-h',
        from: 'api',
        to: 'db',
        label: 'read',
        type: 'SYNCHRONOUS',
      }),
      400,
      participants,
      200,
      { query: 'read', hiddenIds: new Set(['db']) },
    )
    expect(svg).not.toContain('msg-path')
    expect(svg).not.toContain('data-search-hit')
  })

  it('marks a matching label with a text cue, not colour alone', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-s',
        from: 'api',
        to: 'db',
        label: 'Read rows',
        type: 'SYNCHRONOUS',
      }),
      400,
      participants,
      200,
      { query: 'read', hiddenIds: new Set() },
    )
    expect(svg).toContain('data-search-hit="match"')
    expect(svg).toContain('[match]')
    expect(svg).toContain('search-hit')
  })

  it('marks a matching note the same way', () => {
    const svg = renderRowSvg(
      rowFor({ kind: 'note', id: 'n-s', text: 'cache miss', over: 'api', placement: 'over' }),
      400,
      participants,
      200,
      { query: 'CACHE', hiddenIds: new Set() },
    )
    expect(svg).toContain('data-search-hit="match"')
    expect(svg).toContain('[match]')
  })
})

describe('activationBarSvg', () => {
  it('uses the colour and a hatch plus a text label when colour is set', () => {
    const svg = activationBarSvg({ x: 1, y: 2, width: 12, height: 40, colour: '#c026d3', fallback: '#34d399' })
    expect(svg).toContain('style="--pc:#c026d3"')
    expect(svg).toContain('activation-hatch')
    expect(svg).toContain('aria-label="coloured activation"')
    expect(svg).toContain('url(#act-tint-hatch)')
    expect(svg).not.toContain('#34d399')
  })

  it('keeps the default bar when colour is absent', () => {
    const svg = activationBarSvg({ x: 1, y: 2, width: 12, height: 40, fallback: '#34d399' })
    expect(svg).toContain('class="activation"')
    expect(svg).toContain('style="--pc:#34d399"')
    expect(svg).not.toContain('activation-hatch')
    expect(svg).not.toContain('coloured activation')
  })
})
