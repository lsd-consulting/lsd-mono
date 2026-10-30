import { describe, expect, it } from 'vitest'
import type { LayoutRow } from './layout'
import {
  LEFT_PAD,
  MESSAGE_LABEL_RISE,
  NOTE_CARD_MIN_H,
  NOTE_CARD_W,
  NOTE_LINE_H,
  NOTE_PAD_Y,
  SECTION_BAND_H,
  SECTION_BAND_Y,
  SHORT_STUB,
  layoutRows,
  noteCardMetrics,
} from './layout'
import {
  activationBarSvg,
  arrowMarker,
  messageArrowSpec,
  noteLayout,
  participantHead,
  shortMessageEndpoints,
} from './diagram/shapes'
import { arrowLegendHtml, renderDiagramHtml, renderRowSvg } from './sequence-diagram'
import type { DiagramEvent, Participant, Scenario } from '../types'
import { untimed } from './report-fixture.test-util'
import { DEFAULT_LABEL_MAX_CHARS } from '../ui/format'

const participants: Participant[] = [
  { id: 'api', name: 'Api', type: 'participant', color: '#34d399' },
  { id: 'db', name: 'Db', type: 'database', color: '#94a3b8' },
]

function rowFor(event: DiagramEvent): LayoutRow {
  return layoutRows([event])[0]
}

describe('messageArrowSpec', () => {
  it('gives LOST an X tip and a text cue (not colour-only)', () => {
    expect(messageArrowSpec('lost')).toEqual({
      dashed: false,
      dash: null,
      start: 'none',
      end: 'lost',
      typeCue: 'lost',
    })
  })

  it('gives BI_DIRECTIONAL dual filled heads and a cue', () => {
    expect(messageArrowSpec('bi_directional')).toEqual({
      dashed: false,
      dash: null,
      start: 'filled',
      end: 'filled',
      typeCue: '↔',
    })
  })

  it('dots an async arrow and dashes a reply, so they differ by the line and the tip', () => {
    const async = messageArrowSpec('asynchronous')
    const reply = messageArrowSpec('synchronous_response')
    expect(async).toMatchObject({ dashed: true, dash: '2 4', end: 'open' })
    expect(reply).toMatchObject({ dashed: true, dash: '5 4', end: 'filled' })
    expect(async.dash).not.toBe(reply.dash)
    expect(messageArrowSpec('synchronous')).toMatchObject({ dashed: false, dash: null })
  })

  it('draws the async open tip larger than the filled call tip', () => {
    const size = (svg: string) => Number(/markerWidth="([\d.]+)"/.exec(svg)![1])
    expect(size(arrowMarker('a', '#000', 'open'))).toBeGreaterThan(size(arrowMarker('f', '#000', 'filled')))
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
    const { x1, x2 } = shortMessageEndpoints('short_inbound', px, 400)
    expect(x2).toBeLessThan(px)
    expect(x1).toBeLessThan(x2)
    expect(x2 - x1).toBeLessThanOrEqual(SHORT_STUB)
  })

  it('draws SHORT_OUTBOUND from the lifeline toward the right edge', () => {
    const px = LEFT_PAD
    const { x1, x2 } = shortMessageEndpoints('short_outbound', px, 400)
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
        type: 'synchronous',
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
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(html).toContain('<button type="button" class="msg-open"')
    expect(html).toContain('aria-label="Open place order, api to db, call, has payload"')
    expect(html).toContain('data-message-id="m-data"')
    expect(html).not.toContain('aria-haspopup')
    expect(html).not.toContain('aria-modal')
    // The text view lists every message, so the buttons carry no position that would skip gaps.
    expect(html).not.toContain('aria-setsize')
    expect(html).not.toContain('aria-posinset')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('stroke-width="2"')
    expect(html).not.toContain('stroke-width="4"')
    expect(html).not.toContain('role="button"')
  })

  it('marks an arrow with a payload with braces and a title', () => {
    const row = (data?: unknown) =>
      renderRowSvg(
        rowFor({
          kind: 'message',
          id: 'm-p',
          from: 'api',
          to: 'db',
          label: 'ping',
          type: 'synchronous',
          order: 'clock',
          data,
        }),
        400,
        participants,
        DEFAULT_LABEL_MAX_CHARS,
      )
    const html = row({ id: 1 })
    expect(html).toContain('<tspan class="msg-payload" dx="6" aria-hidden="true">{}<title>Has a payload')
    expect(html).not.toContain('msg-clock')
    expect(row()).not.toContain('msg-payload')
  })

  it('does not add an arrow button when there is no payload', () => {
    const html = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-empty',
        from: 'api',
        to: 'db',
        label: 'ping',
        type: 'synchronous',
      }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(html).not.toContain('msg-open')
  })

  it('opens an arrow whose body is deferred behind a payload id', () => {
    const html = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-lazy',
        from: 'api',
        to: 'db',
        label: 'place order',
        type: 'synchronous',
        payloadId: 'sc/m-lazy',
      }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(html).toContain('class="msg-open"')
    expect(html).not.toContain('ord_1')
  })

  it('includes lost X marker and type cue for LOST messages', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-lost',
        from: 'api',
        to: 'db',
        label: 'drop',
        type: 'lost',
      }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(svg).toContain('data-msg-type="lost"')
    expect(svg).toContain('[lost]')
    expect(svg).toContain('M2 2 L10 10')
  })

  it('draws a filled destination head on a synchronous message when the colour is a CSS variable', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-sync',
        from: 'api',
        to: 'db',
        label: 'place order',
        type: 'synchronous',
      }),
      400,
      [
        { id: 'api', name: 'Api', type: 'participant', color: 'var(--accent)' },
        { id: 'db', name: 'Db', type: 'database', color: 'var(--accent)' },
      ],
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(svg).toContain('data-msg-type="synchronous"')
    expect(svg).toContain('marker-end="url(#mk_filled_var--accent)"')
    expect(svg).toContain('id="mk_filled_var--accent"')
    expect(svg).toContain('L10 5 L0 10 z')
    expect(svg).not.toContain('mk_filled_var(--accent)')
    expect(svg).toContain('stroke-width="2"')
  })

  it('draws a reply with an error status in the error colour, and a normal reply neutral', () => {
    const reply = (status: string) =>
      renderRowSvg(
        rowFor({
          kind: 'message',
          id: 'm-reply',
          from: 'db',
          to: 'api',
          label: 'reply',
          type: 'synchronous_response',
          status,
        }),
        400,
        participants,
        DEFAULT_LABEL_MAX_CHARS,
      )
    for (const status of ['error', '500']) {
      expect(reply(status)).toContain('stroke="var(--error)"')
      expect(reply(status)).toContain('marker-end="url(#mk_filled_var--error)"')
    }
    expect(reply('200')).toContain('stroke="var(--diagram-neutral)"')
    expect(reply('200')).not.toContain('var(--error)')
  })

  it('marks an error reply with a class and a cross, so colour is not the only cue', () => {
    const reply = (status: string, colour?: string) =>
      renderRowSvg(
        rowFor({
          kind: 'message',
          id: 'm-reply',
          from: 'db',
          to: 'api',
          label: 'reply',
          type: 'synchronous_response',
          status,
          color: colour,
        }),
        400,
        participants,
        DEFAULT_LABEL_MAX_CHARS,
      )
    for (const status of ['error', '404', '503']) {
      const svg = reply(status)
      expect(svg).toMatch(/<g class="message[^"]* msg-error[ "]/)
      expect(svg).toContain(
        `<tspan class="msg-error-mark" aria-hidden="true">✕ <title>Error: status ${status}</title></tspan>`,
      )
    }
    // A producer's own colour still wins, but the status is still marked.
    expect(reply('503', '#c026d3')).toContain('msg-error-mark')
    for (const status of ['200', '302']) {
      expect(reply(status)).not.toContain('msg-error')
      expect(reply(status)).not.toContain('✕')
    }
  })

  it('keeps the colour a message sets even when its status is an error', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-own',
        from: 'db',
        to: 'api',
        label: 'reply',
        type: 'synchronous_response',
        status: '503',
        color: '#c026d3',
      }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(svg).toContain('stroke="#c026d3"')
    expect(svg).not.toContain('var(--error)')
  })

  it('includes marker-start and marker-end for BI_DIRECTIONAL', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-bi',
        from: 'api',
        to: 'db',
        label: 'sync',
        type: 'bi_directional',
      }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(svg).toContain('data-msg-type="bi_directional"')
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
        type: 'short_inbound',
      }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(inbound).toContain('data-msg-type="short_inbound"')
    expect(inbound).toContain('[in]')
    expect(inbound).toContain('message-short')

    const outbound = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-out',
        from: 'api',
        to: '',
        label: 'emit',
        type: 'short_outbound',
      }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(outbound).toContain('data-msg-type="short_outbound"')
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
        type: 'synchronous',
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
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(left).toContain('data-placement="left"')
    expect(left).toContain('note-left')

    const right = renderRowSvg(
      rowFor({ kind: 'note', id: 'n2', text: 'R', over: 'api', placement: 'right' }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(right).toContain('data-placement="right"')
    expect(right).toContain('note-right')
  })

  it('wraps a long note into tspans and sizes the card to cover every line', () => {
    const text = 'This note deliberately overflows a single 140px line so the card must wrap and grow'
    const card = noteCardMetrics(text)
    expect(card.lines.length).toBeGreaterThan(1)
    const row = rowFor({ kind: 'note', id: 'n-long', text, over: 'api', placement: 'over' })
    expect(row.height).toBeGreaterThan(40)
    const svg = renderRowSvg(row, 400, participants, DEFAULT_LABEL_MAX_CHARS)
    expect(svg).toContain(`width="${NOTE_CARD_W}"`)
    expect(svg).toContain(`height="${card.height}"`)
    // One tspan per wrapped line.
    expect((svg.match(/<tspan x="0"/g) ?? []).length).toBe(card.lines.length)
    for (const line of card.lines) {
      expect(svg).toContain(line)
    }
    // Every line's baseline sits inside the card (card spans -halfH .. +halfH).
    const firstY = Number(/<tspan x="0" y="([^"]+)"/.exec(svg)?.[1])
    expect(firstY).toBeGreaterThan(-card.height / 2)
    expect(firstY + (card.lines.length - 1) * NOTE_LINE_H).toBeLessThan(card.height / 2)
    // Card height tracks line count.
    expect(card.height).toBeGreaterThanOrEqual(card.lines.length * NOTE_LINE_H)
  })

  it('shows only the note text, not its placement (over, left or right)', () => {
    for (const placement of ['over', 'left', 'right'] as const) {
      const svg = renderRowSvg(
        rowFor({ kind: 'note', id: `n-${placement}`, text: 'Payment retried', over: 'api', placement }),
        400,
        participants,
        DEFAULT_LABEL_MAX_CHARS,
      )
      // Placement stays layout data on the group.
      expect(svg).toContain(`data-placement="${placement}"`)
      expect(svg).not.toContain('note-place-cue')
      const text = svg
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      expect(text).toBe('Payment retried')
      expect(svg.toLowerCase()).not.toContain(`>${placement}<`)
    }
  })

  it('sizes a one-line note card to the minimum height without a placement line', () => {
    expect(noteCardMetrics('short').height).toBe(NOTE_CARD_MIN_H)
    const text = 'This note deliberately overflows a single 140px line so the card must wrap and grow'
    const card = noteCardMetrics(text)
    expect(card.height).toBe(Math.max(NOTE_CARD_MIN_H, card.lines.length * NOTE_LINE_H + 2 * NOTE_PAD_Y))
  })

  it('marks a note that matches the search, with no visible text cue', () => {
    const svg = renderRowSvg(
      rowFor({ kind: 'note', id: 'n-hit', text: 'Payment retried', over: 'api', placement: 'over' }),
      400,
      participants,
      DEFAULT_LABEL_MAX_CHARS,
      { query: 'retried', hiddenIds: new Set() },
    )
    expect(svg).toContain('search-hit')
    expect(svg).not.toContain('[match]')
  })

  it('keeps left/right long notes wrapped the same way', () => {
    const text = 'Left placement still wraps a long note inside the same card width'
    const card = noteCardMetrics(text)
    expect(card.lines.length).toBeGreaterThan(1)
    for (const placement of ['left', 'right'] as const) {
      const svg = renderRowSvg(
        rowFor({ kind: 'note', id: `n-${placement}`, text, over: 'api', placement }),
        400,
        participants,
        DEFAULT_LABEL_MAX_CHARS,
      )
      expect(svg).toContain(`data-placement="${placement}"`)
      expect(svg).toContain(`height="${card.height}"`)
      expect((svg.match(/<tspan x="0"/g) ?? []).length).toBe(card.lines.length)
    }
  })
})

describe('section separator', () => {
  it('paints a fixed band and leaves the next message label clear of it', () => {
    const events: DiagramEvent[] = [
      { kind: 'section', id: 's', title: 'Phase 2' },
      { kind: 'message', id: 'm', from: 'api', to: 'db', label: 'place order', type: 'synchronous' },
    ]
    const rows = layoutRows(events)
    const sectionSvg = renderRowSvg(rows[0], 400, participants, DEFAULT_LABEL_MAX_CHARS)
    const messageSvg = renderRowSvg(rows[1], 400, participants, DEFAULT_LABEL_MAX_CHARS)
    expect(sectionSvg).toContain(`y="${SECTION_BAND_Y}"`)
    expect(sectionSvg).toContain(`height="${SECTION_BAND_H}"`)
    expect(sectionSvg).not.toContain(`height="${rows[0].height - 16}"`)
    expect(messageSvg).toContain(`translate(0, ${rows[1].y})`)
    expect(messageSvg).toContain('class="msg-label"')
    const bandBottom = rows[0].y + SECTION_BAND_Y + SECTION_BAND_H
    expect(rows[1].y - MESSAGE_LABEL_RISE).toBeGreaterThan(bandBottom)
  })
})

describe('diagram view paint', () => {
  const three: Participant[] = [...participants, { id: 'queue', name: 'Queue', type: 'queue' }]

  it('shifts the next column left when a participant is hidden', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-q',
        from: 'api',
        to: 'queue',
        label: 'enqueue',
        type: 'synchronous',
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
        type: 'synchronous',
      }),
      400,
      participants,
      200,
      { query: 'read', hiddenIds: new Set(['db']) },
    )
    expect(svg).not.toContain('msg-path')
    expect(svg).not.toContain('data-search-hit')
  })

  it('marks a matching label with a highlight class, no [match] text, and names it on its button', () => {
    const svg = renderRowSvg(
      rowFor({
        kind: 'message',
        id: 'm-s',
        from: 'api',
        to: 'db',
        label: 'Read rows',
        type: 'synchronous',
      }),
      400,
      participants,
      200,
      { query: 'read', hiddenIds: new Set() },
    )
    expect(svg).toContain('data-search-hit="match"')
    expect(svg).not.toContain('[match]')
    expect(svg).toContain('search-hit')
  })

  it('bands the {} marker for a payload match, and says where the match is on the button', () => {
    const msg = {
      kind: 'message' as const,
      id: 'm-p',
      from: 'api',
      to: 'db',
      label: 'read rows',
      type: 'synchronous' as const,
      data: { sql: 'select' },
    }
    const paint = (query: string, searchCurrentId: string | null = null) => ({
      query,
      hiddenIds: new Set<string>(),
      payloadHits: new Set(['m-p']),
      searchCurrentId,
    })
    const payloadOnly = renderRowSvg(rowFor(msg), 400, participants, 200, paint('select'))
    expect(payloadOnly).toContain('search-hit search-in-payload')
    expect(payloadOnly).not.toContain('search-in-label')
    expect(payloadOnly).toContain('data-search-in="payload"')
    expect(payloadOnly).toContain('aria-label="Open read rows, api to db, call, has payload, search match in payload"')
    const both = renderRowSvg(rowFor(msg), 400, participants, 200, paint('read', 'm-p'))
    expect(both).toContain('search-hit search-current search-in-label search-in-payload')
    expect(both).toContain(
      'aria-label="Open read rows, api to db, call, has payload, current search match in label and payload"',
    )
    const label = renderRowSvg(rowFor(msg), 400, participants, 200, { query: 'read', hiddenIds: new Set() })
    expect(label).toContain('search-hit search-in-label"')
    expect(label).toContain('aria-label="Open read rows, api to db, call, has payload, search match"')
  })

  it('marks a matching note the same way, and the current match more strongly', () => {
    const svg = renderRowSvg(
      rowFor({ kind: 'note', id: 'n-s', text: 'cache miss', over: 'api', placement: 'over' }),
      400,
      participants,
      200,
      { query: 'CACHE', hiddenIds: new Set() },
    )
    expect(svg).toContain('data-search-hit="match"')
    expect(svg).not.toContain('[match]')
    const current = renderRowSvg(
      rowFor({ kind: 'note', id: 'n-s', text: 'cache miss', over: 'api', placement: 'over' }),
      400,
      participants,
      200,
      { query: 'CACHE', hiddenIds: new Set(), searchCurrentId: 'n-s' },
    )
    expect(current).toContain('search-hit search-current')
    expect(current).toContain('data-search-hit="current"')
  })
})

describe('activationBarSvg', () => {
  it('uses the colour and a hatch plus a text label when colour is set', () => {
    const svg = activationBarSvg({ x: 1, y: 2, width: 12, height: 40, color: '#c026d3', fallback: '#34d399' })
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

function headerHtml(participants: Participant[], id: string): string {
  const scenario: Scenario = {
    ...untimed(),
    id,
    title: 'Shapes',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants,
    events: [
      {
        kind: 'message',
        id: 'm1',
        from: participants[0]?.id ?? '',
        to: participants[1]?.id ?? participants[0]?.id ?? '',
        label: 'ping',
        type: 'synchronous',
      },
    ],
  }
  const html = renderDiagramHtml(scenario, DEFAULT_LABEL_MAX_CHARS)
  const start = html.indexOf('seq-sticky-header')
  const end = html.indexOf('seq-spacer')
  return html.slice(start, end)
}

describe('participantHead', () => {
  it('draws an actor as a person, not a box', () => {
    const head = participantHead('actor')
    expect(head.type).toBe('actor')
    expect(head.typeLabel).toBe('actor')
    expect(head.shapeSvg).toContain('participant-actor')
    expect(head.shapeSvg).toContain('<circle')
    expect(head.shapeSvg).toContain('L-8 38')
    expect(head.shapeSvg).not.toContain('<rect')
  })

  it('draws a database as a cylinder', () => {
    const head = participantHead('database')
    expect(head.typeLabel).toBe('database')
    expect(head.shapeSvg).toContain('<ellipse')
    expect(head.shapeSvg).toContain('<path')
    expect(head.shapeSvg).not.toContain('<rect')
    expect(head.shapeSvg).not.toContain('participant-actor')
  })

  it('draws a queue as a cylinder on its side, outline only', () => {
    const head = participantHead('queue')
    expect(head.typeLabel).toBe('queue')
    expect(head.shapeSvg).toContain('<path class="participant-shape"')
    expect(head.shapeSvg).toContain('participant-queue-end')
    expect(head.shapeSvg).not.toContain('<polygon')
    expect(head.shapeSvg).not.toContain('<rect')
    const ellipse = /<ellipse[^>]*rx="(\d+)" ry="(\d+)"/.exec(head.shapeSvg)!
    expect(Number(ellipse[2])).toBeGreaterThan(Number(ellipse[1]))
  })

  it('draws the default component as a box', () => {
    const head = participantHead('participant')
    expect(head.type).toBe('participant')
    expect(head.typeLabel).toBe('component')
    expect(head.shapeSvg).toContain('<rect class="participant-shape"')
    expect(head.shapeSvg).not.toContain('<ellipse')
    expect(head.shapeSvg).not.toContain('<polygon')
    expect(head.shapeSvg).not.toContain('participant-actor')
  })

  it('keeps an unknown type on the component box', () => {
    const head = participantHead('CONTROL')
    expect(head).toEqual(participantHead('participant'))
    expect(head.shapeSvg).not.toContain('CONTROL')
    expect(participantHead(undefined)).toEqual(head)
  })

  it('draws entity as a circle and boundary as a circle with a bar', () => {
    const entity = participantHead('entity')
    const boundary = participantHead('boundary')
    expect(entity.typeLabel).toBe('entity')
    expect(entity.shapeSvg).toContain('<circle')
    expect(entity.shapeSvg).not.toContain('<line')
    expect(boundary.typeLabel).toBe('boundary')
    expect(boundary.shapeSvg).toContain('<circle')
    expect(boundary.shapeSvg).toContain('participant-mark')
    expect(entity.shapeSvg).not.toBe(boundary.shapeSvg)
  })

  it('puts actor, database, queue, and the box in the sticky header once', () => {
    const participants: Participant[] = [
      { id: 'user', name: 'User', type: 'actor', color: '#38bdf8' },
      { id: 'api', name: 'Api', type: 'participant' },
      { id: 'orders', name: 'Orders', type: 'database' },
      { id: 'bus', name: 'Bus', type: 'queue' },
    ]
    const header = headerHtml(participants, 'shape-header')
    expect(header).toContain('<title>User, actor</title>')
    expect(header).toContain('<title>Api, component</title>')
    expect(header).toContain('<title>Orders, database</title>')
    expect(header).toContain('<title>Bus, queue</title>')
    expect(header).toContain('data-participant-type="actor"')
    expect(header).toContain('data-participant-type="participant"')
    expect(header).toContain('data-participant-type="database"')
    expect(header).toContain('data-participant-type="queue"')
    expect(header).toContain('participant-actor')
    expect(header.match(/<ellipse/g)).toHaveLength(2)
    expect(header).toContain('participant-queue-end')
    expect(header).toContain('<rect class="participant-shape"')
    expect(header).toContain('style="--pc:#38bdf8"')
    expect(header).toContain('aria-label="Participants: User actor, Api component, Orders database, Bus queue"')
    expect(header.match(/participant-actor/g)).toHaveLength(1)
  })
})

describe('side panel buttons', () => {
  function scenarioWith(events: DiagramEvent[]): Scenario {
    return {
      ...untimed(),
      id: 'comp',
      title: 'Components',
      status: 'success',
      description: '',
      facts: [],
      metrics: [],
      participants,
      events,
    }
  }

  it('shows the arrow key only when a scenario has async messages, with the reply only when there is one', () => {
    const call = { kind: 'message', id: 'm', from: 'api', to: 'db', label: 'read', type: 'synchronous' } as const
    expect(arrowLegendHtml(scenarioWith([call]))).toBe('')
    const async = { ...call, id: 'a', type: 'asynchronous' } as const
    const legend = arrowLegendHtml(scenarioWith([call, async]))
    expect(legend).toContain('class="arrow-legend"')
    expect(legend).toContain('Call')
    expect(legend).toContain('Async (dotted, open tip)')
    expect(legend).toContain('stroke-dasharray="2 4"')
    expect(legend).not.toContain('Reply')
    const reply = { ...call, id: 'r', type: 'synchronous_response' } as const
    const all = arrowLegendHtml(scenarioWith([call, reply, async]))
    expect(all).toContain('Reply')
    expect(all).toContain('stroke-dasharray="5 4"')
    expect(renderDiagramHtml(scenarioWith([call, async]), DEFAULT_LABEL_MAX_CHARS)).toContain('class="arrow-legend"')
  })

  it('explains the {} marker under the toolbar only when an arrow has a payload', () => {
    const plain = { kind: 'message', id: 'm', from: 'api', to: 'db', label: 'read', type: 'synchronous' } as const
    expect(renderDiagramHtml(scenarioWith([plain]), DEFAULT_LABEL_MAX_CHARS)).not.toContain('payload-legend')
    const html = renderDiagramHtml(scenarioWith([{ ...plain, data: { body: '{}' } }]), DEFAULT_LABEL_MAX_CHARS)
    const legend = html.slice(html.indexOf('class="payload-legend"'), html.indexOf('class="seq-stage"'))
    expect(legend).toContain('aria-hidden="true">{}</span>')
    expect(legend).toContain('An arrow marked with braces</span> has a payload')
    expect(legend).toContain('<span class="legend-tap">tap</span>')
  })

  it("has no Component diagram button: the drawing is the diagram area's Components view (#105)", () => {
    const html = renderDiagramHtml(
      scenarioWith([{ kind: 'message', id: 'm', from: 'api', to: 'db', label: 'read', type: 'synchronous' }]),
      DEFAULT_LABEL_MAX_CHARS,
    )
    expect(html).not.toContain('data-show-components')
    expect(html).not.toContain('Component diagram')
    // No metrics in this scenario, so no Metrics button either.
    expect(html).not.toContain('data-show-metrics')
  })
})
