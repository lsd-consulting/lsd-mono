import { describe, expect, it } from 'vitest'
import type { ComponentGraph } from './component-graph'
import { layoutComponents, placeLabels, renderComponentDiagram, renderComponentSvg } from './component-diagram'

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
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="Checkout component diagram, 4 components, 3 links"')
    expect(svg).toContain('data-component="customer" data-participant-type="ACTOR"')
    expect(svg).toContain('class="participant-actor"')
    expect(svg).toContain('class="participant-database"')
    expect(svg).toContain('class="participant-queue"')
    expect(svg).toContain('style="--pc:#38bdf8"')
    expect(svg.match(/class="component-node/g)).toHaveLength(4)
    expect(svg).toContain('<title>Customer, actor</title>')
  })

  it('labels every edge in text, with type and fold count, and dashes async', () => {
    const { svg } = renderComponentDiagram(checkout, 'Checkout')
    expect(svg.match(/class="edge-group"/g)).toHaveLength(3)
    expect(svg).toContain('POST /checkout · sync')
    expect(svg).toContain('INSERT order · sync ×2')
    expect(svg).toContain('class="edge edge-async"')
    expect(svg).toContain('marker-end="url(#lsd-comp-open)"')
    expect(svg).toContain('<title>CheckoutAPI to OrdersDB: INSERT order · sync ×2</title>')
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

  it('keeps every caption inside the viewBox', () => {
    const { svg } = renderComponentDiagram(
      {
        nodes: [
          { id: 'a', name: 'A', type: 'PARTICIPANT' },
          { id: 'b', name: 'B', type: 'PARTICIPANT' },
        ],
        edges: [{ from: 'a', to: 'b', types: ['SYNCHRONOUS'], count: 1, label: 'x'.repeat(80) }],
      },
      'Long',
    )
    const [vx, , vw] = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number)
    const label = svg.match(/<text class="edge-label" x="([\d.-]+)"[^>]*text-anchor="(\w+)">([^<]+)</)!
    const x = Number(label[1])
    expect(label[3].endsWith('…')).toBe(true)
    expect(label[2]).toBe('start')
    expect(x).toBeGreaterThanOrEqual(vx)
    expect(x + label[3].length * 6.2).toBeLessThanOrEqual(vx + vw)
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

describe('placeLabels', () => {
  it('moves a caption off an earlier caption and off a component', () => {
    const placed = placeLabels(
      [
        { x: 0, y: 20, anchor: 'start', text: 'first caption' },
        { x: 10, y: 20, anchor: 'start', text: 'second caption' },
        { x: 0, y: 100, anchor: 'start', text: 'under a node' },
      ],
      [{ x: -10, y: 80, w: 120, h: 30 }],
    )
    expect(placed[0].y).toBe(20)
    expect(placed[1].y).not.toBe(20)
    expect(Math.abs(placed[1].y - 20)).toBeGreaterThanOrEqual(14)
    expect(placed[2].y === 100).toBe(false)
  })
})
