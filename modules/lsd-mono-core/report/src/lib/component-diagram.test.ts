import { describe, expect, it } from 'vitest'
import type { ComponentGraph } from './component-graph'
import { layoutComponents, renderComponentDiagram, renderComponentSvg } from './component-diagram'

const checkout: ComponentGraph = {
  nodes: [
    { id: 'customer', name: 'Customer', type: 'ACTOR', colour: '#38bdf8' },
    { id: 'api', name: 'CheckoutAPI', type: 'PARTICIPANT' },
    { id: 'db', name: 'OrdersDB', type: 'DATABASE' },
    { id: 'bus', name: 'EventBus', type: 'QUEUE' },
  ],
  edges: [
    { from: 'customer', to: 'api', types: ['SYNCHRONOUS'], count: 1, label: 'POST /checkout' },
    { from: 'api', to: 'db', types: ['SYNCHRONOUS'], count: 2, label: 'INSERT order' },
    { from: 'api', to: 'bus', types: ['ASYNCHRONOUS'], count: 1, label: 'OrderPlaced' },
  ],
}

describe('layoutComponents', () => {
  it('puts callers above the components they call', () => {
    const { places, ranks } = layoutComponents(checkout)
    expect(ranks).toEqual([['customer'], ['api'], ['db', 'bus']])
    expect(places.get('customer')!.y).toBeLessThan(places.get('api')!.y)
    expect(places.get('api')!.y).toBeLessThan(places.get('db')!.y)
    expect(places.get('db')!.y).toBe(places.get('bus')!.y)
    expect(places.get('db')!.x).toBeLessThan(places.get('bus')!.x)
  })

  it('terminates on a cycle and keeps every node', () => {
    const { places, ranks } = layoutComponents({
      nodes: [
        { id: 'a', name: 'A', type: 'PARTICIPANT' },
        { id: 'b', name: 'B', type: 'PARTICIPANT' },
        { id: 'c', name: 'C', type: 'PARTICIPANT' },
      ],
      edges: [
        { from: 'a', to: 'b', types: ['SYNCHRONOUS'], count: 1 },
        { from: 'b', to: 'c', types: ['SYNCHRONOUS'], count: 1 },
        { from: 'c', to: 'a', types: ['ASYNCHRONOUS'], count: 1 },
        { from: 'b', to: 'b', types: ['SYNCHRONOUS'], count: 1 },
      ],
    })
    expect(ranks).toEqual([['a'], ['b'], ['c']])
    expect(places.size).toBe(3)
  })
})

describe('renderComponentDiagram', () => {
  it('draws each component with its participant shape, name, and colour', () => {
    const { svg, width, height } = renderComponentDiagram(checkout, 'Checkout')
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(svg).toContain('role="group"')
    expect(svg).toContain('aria-label="Checkout component diagram, 4 components, 3 links"')
    expect(svg).toContain('data-component="customer" data-participant-type="ACTOR"')
    expect(svg).toContain('class="participant-actor"')
    expect(svg).toContain('class="participant-database"')
    expect(svg).toContain('class="participant-queue"')
    expect(svg).toContain('style="--pc:#38bdf8"')
    expect(svg.match(/class="component-node/g)).toHaveLength(4)
    expect(svg).toContain('<title>Customer, actor</title>')
  })

  it('draws links without captions, keeps the line style and direction, and counts busy links', () => {
    const { svg } = renderComponentDiagram(checkout, 'Checkout')
    expect(svg.match(/class="edge-group"/g)).toHaveLength(3)
    expect(svg).not.toContain('edge-label')
    expect(svg).not.toMatch(/<text[^>]*>POST \/checkout/)
    expect(svg).toContain('class="edge edge-async"')
    expect(svg).toContain('marker-end="url(#lsd-comp-open)"')
    expect(svg).toContain('marker-end="url(#lsd-comp-filled)"')
    // Only api to db carries more than one message.
    const badges = [...svg.matchAll(/<g class="edge-badge"[^>]*>.*?<text[^>]*>(\d+)<\/text><\/g>/g)].map((m) => m[1])
    expect(badges).toEqual(['2'])
    expect(svg).toContain('<title>CheckoutAPI to OrdersDB, 2 interactions:\nINSERT order · sync ×2</title>')
    expect(svg).toContain('<title>Customer to CheckoutAPI, 1 interaction:\nPOST /checkout · sync</title>')
  })

  it('makes each link a focusable button with a wide hit area', () => {
    const { svg } = renderComponentDiagram(checkout, 'Checkout')
    expect(svg).toContain(
      'data-edge-index="1" data-edge-from="api" data-edge-to="db" tabindex="0" role="button" aria-label="CheckoutAPI to OrdersDB, 2 interactions"',
    )
    expect(svg.match(/class="edge-hit"/g)).toHaveLength(3)
  })

  it('puts the badge short of the middle, so an opposing pair keeps both badges apart', () => {
    const { svg } = renderComponentDiagram(
      {
        nodes: [
          { id: 'a', name: 'A', type: 'PARTICIPANT' },
          { id: 'b', name: 'B', type: 'PARTICIPANT' },
        ],
        edges: [
          { from: 'a', to: 'b', types: ['SYNCHRONOUS'], count: 3, label: 'go' },
          { from: 'b', to: 'a', types: ['ASYNCHRONOUS'], count: 4, label: 'back' },
        ],
      },
      'Pair',
    )
    const at = [...svg.matchAll(/class="edge-badge" transform="translate\(([\d.-]+), ([\d.-]+)\)"/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ])
    expect(at).toHaveLength(2)
    expect(Math.hypot(at[0][0] - at[1][0], at[0][1] - at[1][1])).toBeGreaterThan(20)
    const [vx, vy, vw, vh] = svg
      .match(/viewBox="([^"]+)"/)![1]
      .split(' ')
      .map(Number)
    for (const [x, y] of at) {
      expect(x).toBeGreaterThan(vx)
      expect(x).toBeLessThan(vx + vw)
      expect(y).toBeGreaterThan(vy)
      expect(y).toBeLessThan(vy + vh)
    }
  })

  it('splits an opposing pair and draws a self call as a loop', () => {
    const { svg } = renderComponentDiagram(
      {
        nodes: [
          { id: 'a', name: 'A', type: 'PARTICIPANT' },
          { id: 'b', name: 'B', type: 'PARTICIPANT' },
        ],
        edges: [
          { from: 'a', to: 'b', types: ['SYNCHRONOUS'], count: 1, label: 'go' },
          { from: 'b', to: 'a', types: ['BI_DIRECTIONAL'], count: 1, label: 'back' },
          { from: 'a', to: 'a', types: ['LOST'], count: 1, label: 'retry' },
        ],
      },
      'Pair',
    )
    const lines = [...svg.matchAll(/<line class="edge" x1="([\d.-]+)"/g)].map((m) => Number(m[1]))
    expect(lines).toHaveLength(2)
    expect(lines[0]).not.toBe(lines[1])
    expect(svg).toContain('marker-start="url(#lsd-comp-filled)"')
    expect(svg).toMatch(/<path d="M [^"]+ C [^"]+" class="edge" marker-end="url\(#lsd-comp-lost\)"/)
  })

  it('escapes names and labels', () => {
    const svg = renderComponentSvg(
      {
        nodes: [
          { id: 'a', name: '<script>', type: 'PARTICIPANT' },
          { id: 'b', name: 'B"', type: 'PARTICIPANT' },
        ],
        edges: [{ from: 'a', to: 'b', types: ['SYNCHRONOUS'], count: 1, label: 'a & b' }],
      },
      'T',
    )
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('a &amp; b')
  })

  it('says there is nothing to draw for an empty graph', () => {
    expect(renderComponentSvg({ nodes: [], edges: [] }, 'Empty')).toContain('Nothing to draw')
  })
})
