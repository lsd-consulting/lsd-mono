import { describe, expect, it } from 'vitest'
import type { DiagramEvent, MessageType, Participant, Scenario } from '../types'
import {
  COMPONENT_EDGE_TYPES,
  componentEdgeTitle,
  componentGraph,
  edgeInteractions,
  hasComponentDiagram,
  typeCue,
} from './component-graph'
import { untimed } from './report-fixture.test-util'

function scenario(events: DiagramEvent[], participants: Participant[] = []): Scenario {
  return {
    ...untimed(),
    id: 's',
    title: 'Sample',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants,
    events,
  }
}

const participants: Participant[] = [
  { id: 'customer', name: 'Customer', type: 'actor', color: '#38bdf8' },
  { id: 'api', name: 'CheckoutAPI', displayName: 'API', type: 'participant', color: '#34d399' },
  { id: 'db', name: 'OrdersDB', type: 'database' },
  { id: 'bus', name: 'EventBus', type: 'queue' },
]

describe('componentGraph', () => {
  it('builds nodes and edges from dependency messages, folding duplicates', () => {
    const graph = componentGraph(
      scenario(
        [
          {
            kind: 'message',
            id: '1',
            from: 'customer',
            to: 'api',
            label: 'POST /checkout',
            type: 'synchronous',
          },
          {
            kind: 'message',
            id: '2',
            from: 'api',
            to: 'customer',
            label: '201 Created',
            type: 'synchronous_response',
          },
          {
            kind: 'message',
            id: '3',
            from: 'api',
            to: 'db',
            label: 'INSERT order',
            type: 'synchronous',
          },
          {
            kind: 'message',
            id: '4',
            from: 'api',
            to: 'db',
            label: 'SELECT stock',
            type: 'synchronous',
          },
          {
            kind: 'message',
            id: '5',
            from: 'api',
            to: 'bus',
            label: 'OrderPlaced',
            type: 'asynchronous',
          },
          {
            kind: 'message',
            id: '6',
            from: '',
            to: 'api',
            label: 'probe',
            type: 'short_inbound',
          },
          { kind: 'note', id: 'n1', text: 'ignored', placement: 'over' },
        ],
        participants,
      ),
    )

    expect(graph.nodes.map((n) => n.id)).toEqual(['customer', 'api', 'db', 'bus'])
    expect(graph.nodes[0]).toMatchObject({ name: 'Customer', type: 'actor', color: '#38bdf8' })
    expect(graph.nodes[1]).toMatchObject({ name: 'API', type: 'participant' })
    expect(graph.edges).toEqual([
      {
        from: 'customer',
        to: 'api',
        types: ['synchronous'],
        count: 1,
        label: 'POST /checkout',
        interactions: [{ label: 'POST /checkout', type: 'synchronous', count: 1, messageIds: ['1'] }],
      },
      {
        from: 'api',
        to: 'db',
        types: ['synchronous'],
        count: 2,
        label: 'INSERT order',
        interactions: [
          { label: 'INSERT order', type: 'synchronous', count: 1, messageIds: ['3'] },
          { label: 'SELECT stock', type: 'synchronous', count: 1, messageIds: ['4'] },
        ],
      },
      {
        from: 'api',
        to: 'bus',
        types: ['asynchronous'],
        count: 1,
        label: 'OrderPlaced',
        interactions: [{ label: 'OrderPlaced', type: 'asynchronous', count: 1, messageIds: ['5'] }],
      },
    ])
  })

  it('keeps an unknown participant id with a default type', () => {
    const graph = componentGraph(
      scenario([
        {
          kind: 'message',
          id: '1',
          from: 'ghost',
          to: 'api',
          label: 'ping',
          type: 'lost',
        },
      ]),
    )
    expect(graph.nodes).toEqual([
      { id: 'ghost', name: 'ghost', type: 'participant' },
      { id: 'api', name: 'api', type: 'participant' },
    ])
    expect(graph.edges[0].types).toEqual(['lost'])
  })

  it('merges mixed types on the same from-to pair', () => {
    const graph = componentGraph(
      scenario([
        {
          kind: 'message',
          id: '1',
          from: 'a',
          to: 'b',
          label: 'call',
          type: 'synchronous',
        },
        {
          kind: 'message',
          id: '2',
          from: 'a',
          to: 'b',
          label: 'notify',
          type: 'asynchronous',
        },
        {
          kind: 'message',
          id: '3',
          from: 'a',
          to: 'b',
          label: '',
          type: 'bi_directional',
        },
      ]),
    )
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({
      types: ['synchronous', 'asynchronous', 'bi_directional'],
      count: 3,
      label: 'call',
    })
  })

  it('reports whether anything would draw', () => {
    expect(hasComponentDiagram(scenario([]))).toBe(false)
    expect(
      hasComponentDiagram(
        scenario([
          {
            kind: 'message',
            id: '1',
            from: 'a',
            to: '',
            label: 'out',
            type: 'short_outbound',
          },
        ]),
      ),
    ).toBe(false)
    expect(
      hasComponentDiagram(
        scenario([
          {
            kind: 'message',
            id: '1',
            from: 'a',
            to: 'b',
            label: 'hi',
            type: 'synchronous',
          },
        ]),
      ),
    ).toBe(true)
  })
})

describe('link interactions', () => {
  const message = (id: string, label: string, type: MessageType = 'synchronous'): DiagramEvent => ({
    kind: 'message',
    id,
    from: 'api',
    to: 'db',
    label,
    type,
  })

  it('groups repeated messages on a link by label and type, in first-seen order', () => {
    const graph = componentGraph(
      scenario([
        message('1', 'INSERT order'),
        message('2', 'SELECT stock'),
        message('3', 'INSERT order'),
        message('4', 'INSERT order', 'asynchronous'),
        message('5', '  '),
      ]),
    )
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].count).toBe(5)
    expect(graph.edges[0].interactions).toEqual([
      // Each with its messages, in order: Show in sequence (#105) goes to the first.
      { label: 'INSERT order', type: 'synchronous', count: 2, messageIds: ['1', '3'] },
      { label: 'SELECT stock', type: 'synchronous', count: 1, messageIds: ['2'] },
      { label: 'INSERT order', type: 'asynchronous', count: 1, messageIds: ['4'] },
      { label: '', type: 'synchronous', count: 1, messageIds: ['5'] },
    ])
  })

  it('titles a link with its direction, total, and one line per interaction', () => {
    expect(typeCue('asynchronous')).toBe('async')
    expect(COMPONENT_EDGE_TYPES.has('synchronous_response')).toBe(false)
    const graph = componentGraph(
      scenario([
        message('1', 'INSERT order'),
        message('2', 'INSERT order'),
        message('3', ''),
        message('4', 'publish', 'asynchronous'),
      ]),
    )
    expect(componentEdgeTitle(graph.edges[0], 'Checkout', 'Orders DB')).toBe(
      ['Checkout to Orders DB, 4 interactions:', 'INSERT order · sync ×2', '(no label) · sync', 'publish · async'].join(
        '\n',
      ),
    )
    expect(componentEdgeTitle({ from: 'a', to: 'b', types: ['lost'], count: 1, label: 'ping' }, 'A', 'B')).toBe(
      'A to B, 1 interaction:\nping · lost',
    )
  })

  it('lists at most a dozen interactions in the title, then says how many more', () => {
    const graph = componentGraph(scenario(Array.from({ length: 15 }, (_, i) => message(String(i), `call ${i}`))))
    const lines = componentEdgeTitle(graph.edges[0], 'A', 'B').split('\n')
    expect(lines).toHaveLength(14)
    expect(lines[12]).toBe('call 11 · sync')
    expect(lines[13]).toBe('…and 3 more')
  })

  it('falls back to the first label for an edge built without interactions', () => {
    expect(edgeInteractions({ from: 'a', to: 'b', types: ['synchronous', 'asynchronous'], count: 2 })).toEqual([
      { label: '', type: 'synchronous, asynchronous', count: 2 },
    ])
  })
})
