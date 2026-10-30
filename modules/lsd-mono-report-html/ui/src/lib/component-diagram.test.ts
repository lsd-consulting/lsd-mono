import { describe, expect, it } from 'vitest'
import type { ComponentGraph } from './component-graph'
import { componentGraph } from './component-graph'
import { conformanceReport } from './conformance.test-util'
import {
  ONE_COLUMN_BELOW_PX,
  WRAP_RATIO,
  layoutComponents,
  renderComponentDiagram,
  renderComponentSvg,
  wrapRanks,
} from './component-diagram'

const checkout: ComponentGraph = {
  nodes: [
    { id: 'customer', name: 'Customer', type: 'actor', color: '#38bdf8' },
    { id: 'api', name: 'CheckoutAPI', type: 'participant' },
    { id: 'db', name: 'OrdersDB', type: 'database' },
    { id: 'bus', name: 'EventBus', type: 'queue' },
  ],
  edges: [
    { from: 'customer', to: 'api', types: ['synchronous'], count: 1, label: 'POST /checkout' },
    { from: 'api', to: 'db', types: ['synchronous'], count: 2, label: 'INSERT order' },
    { from: 'api', to: 'bus', types: ['asynchronous'], count: 1, label: 'OrderPlaced' },
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
        { id: 'a', name: 'A', type: 'participant' },
        { id: 'b', name: 'B', type: 'participant' },
        { id: 'c', name: 'C', type: 'participant' },
      ],
      edges: [
        { from: 'a', to: 'b', types: ['synchronous'], count: 1 },
        { from: 'b', to: 'c', types: ['synchronous'], count: 1 },
        { from: 'c', to: 'a', types: ['asynchronous'], count: 1 },
        { from: 'b', to: 'b', types: ['synchronous'], count: 1 },
      ],
    })
    expect(ranks).toEqual([['a'], ['b'], ['c']])
    expect(places.size).toBe(3)
  })
})

/** A call chain n long: c00 → c01 → … , one component per rank. */
function chain(n: number): ComponentGraph {
  const id = (i: number) => `c${String(i).padStart(2, '0')}`
  return {
    nodes: Array.from({ length: n }, (_, i) => ({ id: id(i), name: id(i), type: 'participant' })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ from: id(i), to: id(i + 1), types: ['synchronous'], count: 1 })),
  }
}

describe('very tall graphs wrap into columns (#115)', () => {
  it('keeps one column up to WRAP_RATIO times taller than wide', () => {
    // 3 ranks of a 150 px row: 3 × 140 − 84 = 336 px tall, under 3 × 150; 4 ranks of a 180 px row too.
    expect(wrapRanks([150, 150, 150])).toEqual([[0, 1, 2]])
    expect(wrapRanks([180, 150, 150, 150])).toEqual([[0, 1, 2, 3]])
    expect(wrapRanks([150])).toEqual([[0]])
    expect(wrapRanks([])).toEqual([[]])
    expect(WRAP_RATIO).toBe(3)
  })

  it('splits a deeper run of ranks into equal runs for a drawing about as wide as tall', () => {
    // 12 ranks: 1596 px over 150 px, 10.6 times; √10.6 rounds to 3 columns of 4 ranks.
    expect(wrapRanks(Array<number>(12).fill(150))).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
    ])
    // Just over the ratio: still at least two columns.
    expect(wrapRanks(Array<number>(5).fill(150))).toEqual([
      [0, 1, 2],
      [3, 4],
    ])
  })

  it('lays a long chain out in columns, left to right, each read top-down', () => {
    const { places, columns } = layoutComponents(chain(12))
    expect(columns).toHaveLength(3)
    const at = (i: number) => places.get(`c${String(i).padStart(2, '0')}`)!
    expect([0, 4, 8].map((i) => at(i).y)).toEqual([0, 0, 0])
    expect(at(0).x).toBeLessThan(at(4).x)
    expect(at(4).x).toBeLessThan(at(8).x)
    expect(at(3).y).toBeGreaterThan(at(0).y)
    expect(at(3).x).toBe(at(0).x)
    expect([at(0).column, at(5).column, at(11).column]).toEqual([0, 1, 2])
    expect(at(5).rank).toBe(5)
    const drawn = renderComponentDiagram(chain(12), 'Chain')
    expect(drawn.height / drawn.width).toBeLessThan(WRAP_RATIO)
    expect(drawn.height).toBeLessThan(4 * 140 + 100)
    // Every link is still drawn and focusable, in the same order.
    const links = [...drawn.svg.matchAll(/data-edge-index="(\d+)"[^>]*tabindex="0"/g)].map((m) => Number(m[1]))
    expect(links).toEqual(Array.from({ length: 11 }, (_, i) => i))
  })

  it('wraps the 100-component perf sample to about square, and leaves every example scenario as it was', async () => {
    const { wideReport } = await import('../../checks/wide-sample')
    const wide = renderComponentDiagram(componentGraph(wideReport(100, 400).scenarios[0]), 'Wide')
    // Was 888 × 9048 px in one column.
    expect(wide.height / wide.width).toBeGreaterThan(0.5)
    expect(wide.height / wide.width).toBeLessThan(2)
    const example = conformanceReport('example-report')
    for (const scenario of example.scenarios)
      expect(layoutComponents(componentGraph(scenario)).columns, scenario.id).toHaveLength(1)
  })
})

describe('the columns fit the room at 1:1 (#121)', () => {
  it('caps the columns, and keeps them equal runs in rank order', () => {
    expect(wrapRanks(Array<number>(12).fill(150), 2)).toEqual([
      [0, 1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10, 11],
    ])
    expect(wrapRanks(Array<number>(12).fill(150), 1)).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]])
    expect(layoutComponents(chain(12), 1).columns).toHaveLength(1)
  })

  it('draws one column in a scrollport narrower than 600 px, and the squarer layout from there up', async () => {
    const { wideReport } = await import('../../checks/wide-sample')
    const graph = componentGraph(wideReport(100, 400).scenarios[0])
    const free = renderComponentDiagram(graph, 'Wide')
    expect(free.columns).toBeGreaterThan(2)
    expect(ONE_COLUMN_BELOW_PX).toBe(600)
    // A 390 px phone's scrollport: the one column it had before #115.
    expect(renderComponentDiagram(graph, 'Wide', 360).columns).toBe(1)
    expect(renderComponentDiagram(graph, 'Wide', 599).columns).toBe(1)
    // From 600 up the #115 layout, even where it is wider than the room at 1:1 (Overview fits it).
    expect(renderComponentDiagram(graph, 'Wide', 600)).toEqual(free)
    expect(free.width).toBeGreaterThan(600)
    expect(renderComponentDiagram(graph, 'Wide', 1200)).toEqual(free)
  })

  it('leaves a graph that does not wrap alone in any room', () => {
    const drawn = renderComponentDiagram(checkout, 'Checkout')
    expect(renderComponentDiagram(checkout, 'Checkout', 100)).toEqual(drawn)
    expect(drawn.columns).toBe(1)
  })
})

describe('renderComponentDiagram', () => {
  it('draws each component with its participant shape, name, and colour', () => {
    const { svg, width, height } = renderComponentDiagram(checkout, 'Checkout')
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(svg).toContain('role="group"')
    expect(svg).toContain('aria-label="Checkout component diagram, 4 components, 3 links"')
    expect(svg).toContain('data-component="customer" data-participant-type="actor"')
    expect(svg).toContain('class="participant-actor"')
    expect(svg).toContain('class="participant-database"')
    expect(svg).toContain('class="participant-queue"')
    expect(svg).toContain('style="--pc:#38bdf8"')
    expect(svg.match(/class="component-node/g)).toHaveLength(4)
    expect(svg).toContain('<title>Customer, actor</title>')
    // narrow.css keeps a phone panel at this natural width, scrolling sideways (#66).
    expect(svg).toContain(`style="max-width:${width}px;--component-width:${width}px"`)
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
          { id: 'a', name: 'A', type: 'participant' },
          { id: 'b', name: 'B', type: 'participant' },
        ],
        edges: [
          { from: 'a', to: 'b', types: ['synchronous'], count: 3, label: 'go' },
          { from: 'b', to: 'a', types: ['asynchronous'], count: 4, label: 'back' },
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
          { id: 'a', name: 'A', type: 'participant' },
          { id: 'b', name: 'B', type: 'participant' },
        ],
        edges: [
          { from: 'a', to: 'b', types: ['synchronous'], count: 1, label: 'go' },
          { from: 'b', to: 'a', types: ['bi_directional'], count: 1, label: 'back' },
          { from: 'a', to: 'a', types: ['lost'], count: 1, label: 'retry' },
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
          { id: 'a', name: '<script>', type: 'participant' },
          { id: 'b', name: 'B"', type: 'participant' },
        ],
        edges: [{ from: 'a', to: 'b', types: ['synchronous'], count: 1, label: 'a & b' }],
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
