import { describe, expect, it } from 'vitest'
import type { DiagramEvent, Participant, Scenario } from '../types'
import {
  COMPONENT_EDGE_TYPES,
  componentEdgeCaption,
  componentGraph,
  hasComponentDiagram,
  typeCue,
} from './component-graph'

function scenario(events: DiagramEvent[], participants: Participant[] = []): Scenario {
  return {
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
  { id: 'customer', name: 'Customer', type: 'ACTOR', colour: '#38bdf8' },
  { id: 'api', name: 'CheckoutAPI', alias: 'API', type: 'PARTICIPANT', colour: '#34d399' },
  { id: 'db', name: 'OrdersDB', type: 'DATABASE' },
  { id: 'bus', name: 'EventBus', type: 'QUEUE' },
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
            type: 'SYNCHRONOUS',
          },
          {
            kind: 'message',
            id: '2',
            from: 'api',
            to: 'customer',
            label: '201 Created',
            type: 'SYNCHRONOUS_RESPONSE',
          },
          {
            kind: 'message',
            id: '3',
            from: 'api',
            to: 'db',
            label: 'INSERT order',
            type: 'SYNCHRONOUS',
          },
          {
            kind: 'message',
            id: '4',
            from: 'api',
            to: 'db',
            label: 'SELECT stock',
            type: 'SYNCHRONOUS',
          },
          {
            kind: 'message',
            id: '5',
            from: 'api',
            to: 'bus',
            label: 'OrderPlaced',
            type: 'ASYNCHRONOUS',
          },
          {
            kind: 'message',
            id: '6',
            from: '',
            to: 'api',
            label: 'probe',
            type: 'SHORT_INBOUND',
          },
          { kind: 'note', id: 'n1', text: 'ignored' },
        ],
        participants,
      ),
    )

    expect(graph.nodes.map((n) => n.id)).toEqual(['customer', 'api', 'db', 'bus'])
    expect(graph.nodes[0]).toMatchObject({ name: 'Customer', type: 'ACTOR', colour: '#38bdf8' })
    expect(graph.nodes[1]).toMatchObject({ name: 'API', type: 'PARTICIPANT' })
    expect(graph.edges).toEqual([
      {
        from: 'customer',
        to: 'api',
        types: ['SYNCHRONOUS'],
        count: 1,
        label: 'POST /checkout',
      },
      {
        from: 'api',
        to: 'db',
        types: ['SYNCHRONOUS'],
        count: 2,
        label: 'INSERT order',
      },
      {
        from: 'api',
        to: 'bus',
        types: ['ASYNCHRONOUS'],
        count: 1,
        label: 'OrderPlaced',
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
          type: 'LOST',
        },
      ]),
    )
    expect(graph.nodes).toEqual([
      { id: 'ghost', name: 'ghost', type: 'PARTICIPANT' },
      { id: 'api', name: 'api', type: 'PARTICIPANT' },
    ])
    expect(graph.edges[0].types).toEqual(['LOST'])
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
          type: 'SYNCHRONOUS',
        },
        {
          kind: 'message',
          id: '2',
          from: 'a',
          to: 'b',
          label: 'notify',
          type: 'ASYNCHRONOUS',
        },
        {
          kind: 'message',
          id: '3',
          from: 'a',
          to: 'b',
          label: '',
          type: 'BI_DIRECTIONAL',
        },
      ]),
    )
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({
      types: ['SYNCHRONOUS', 'ASYNCHRONOUS', 'BI_DIRECTIONAL'],
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
            type: 'SHORT_OUTBOUND',
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
            type: 'SYNCHRONOUS',
          },
        ]),
      ),
    ).toBe(true)
  })
})

describe('captions', () => {
  it('spells out the type and the fold count', () => {
    expect(typeCue('ASYNCHRONOUS')).toBe('async')
    expect(COMPONENT_EDGE_TYPES.has('SYNCHRONOUS_RESPONSE')).toBe(false)
    expect(
      componentEdgeCaption({
        from: 'a',
        to: 'b',
        types: ['SYNCHRONOUS'],
        count: 1,
        label: 'place order',
      }),
    ).toBe('place order · sync')
    expect(
      componentEdgeCaption({
        from: 'a',
        to: 'b',
        types: ['ASYNCHRONOUS'],
        count: 3,
        label: 'publish',
      }),
    ).toBe('publish · async ×3')
    expect(
      componentEdgeCaption({
        from: 'a',
        to: 'b',
        types: ['SYNCHRONOUS', 'ASYNCHRONOUS'],
        count: 2,
      }),
    ).toBe('sync, async ×2')
  })
})
