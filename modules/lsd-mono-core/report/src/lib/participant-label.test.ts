// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { Participant, ParticipantType, Scenario } from '../types'
import { COL_GAP, HEADER_BLOCK_H, LEFT_PAD } from './layout'
import { ELLIPSIS, NAME_MAX_W, fitName, nameWidth } from './participant-label'
import {
  LANE_GAP,
  bindDiagramScroll,
  diagramPads,
  laneCentres,
  participantHead,
  participantHeadFor,
  participantLabelSvg,
  renderDiagramHtml,
  syncDiagramWindow,
} from './sequence-diagram'
import { layoutComponents, renderComponentDiagram } from './component-diagram'
import { componentGraph } from './component-graph'

const TYPES: ParticipantType[] = ['ACTOR', 'PARTICIPANT', 'DATABASE', 'QUEUE', 'ENTITY', 'BOUNDARY']
const LONG = 'Customer Notification Preferences and Delivery Orchestration Service'
const MEDIUM = 'Orders DB (PostgreSQL primary)'

describe('nameWidth', () => {
  it('adds measured glyph widths, wider for capitals and CJK', () => {
    expect(nameWidth('')).toBe(0)
    expect(nameWidth('ii')).toBeLessThan(nameWidth('mm'))
    expect(nameWidth('WW')).toBeGreaterThan(nameWidth('ww'))
    expect(nameWidth('注文')).toBeGreaterThan(nameWidth('ab'))
    expect(nameWidth('Order Service')).toBeGreaterThan(70)
    expect(nameWidth('Order Service')).toBeLessThan(90)
  })
})

describe('fitName', () => {
  it('keeps a name that fits on one line, as written', () => {
    expect(fitName('Order  Service ')).toEqual({
      lines: ['Order Service'],
      width: nameWidth('Order Service'),
      truncated: false,
    })
  })

  it('wraps a longer name at a space onto two lines, each within the limit', () => {
    const fit = fitName(MEDIUM)
    expect(nameWidth(MEDIUM)).toBeGreaterThan(NAME_MAX_W)
    expect(fit.lines).toEqual(['Orders DB (PostgreSQL', 'primary)'])
    expect(fit.truncated).toBe(false)
    expect(fit.width).toBeLessThanOrEqual(NAME_MAX_W)
  })

  it('ends the second line in an ellipsis when two lines are not enough', () => {
    const fit = fitName(LONG)
    expect(fit.lines).toHaveLength(2)
    expect(fit.lines[1].endsWith(ELLIPSIS)).toBe(true)
    expect(fit.truncated).toBe(true)
    for (const line of fit.lines) expect(nameWidth(line)).toBeLessThanOrEqual(NAME_MAX_W)
    expect(LONG.startsWith(`${fit.lines[0]} ${fit.lines[1].slice(0, -1)}`)).toBe(true)
  })

  it('breaks a single long word mid-word, and after hyphens and dots', () => {
    const word = fitName('x'.repeat(80))
    expect(word.lines).toHaveLength(2)
    expect(word.lines[0]).toMatch(/^x+$/)
    expect(word.truncated).toBe(true)
    const dotted = fitName('kafka.topic.order-events.v2.dead-letter-queue')
    expect(dotted.lines[0]).toMatch(/[.-]$/)
    for (const line of dotted.lines) expect(nameWidth(line)).toBeLessThanOrEqual(NAME_MAX_W)
  })
})

describe('participantHead with a fitted name', () => {
  it('draws short names exactly as before', () => {
    for (const type of TYPES)
      expect(participantHead(type, fitName('Api')).shapeSvg).toBe(participantHead(type).shapeSvg)
  })

  it.each(['PARTICIPANT', 'DATABASE', 'QUEUE'] as const)('grows the %s shape to hold the name inside it', (type) => {
    for (const name of ['Inventory Service', 'Payment Provider (ext)', MEDIUM, LONG]) {
      const head = participantHeadFor({ type, name })
      // At least 10px of padding each side of the widest line.
      expect(head.shapeHalf * 2 - head.name.width).toBeGreaterThanOrEqual(20)
      expect(head.shapeHalf * 2).toBeLessThanOrEqual(NAME_MAX_W + 40)
    }
  })

  it.each(TYPES)('keeps a two-line %s name inside the header', (type) => {
    const head = participantHeadFor({ type, name: LONG })
    expect(head.labelYs).toHaveLength(2)
    expect(head.labelYs[1] - head.labelYs[0]).toBeGreaterThanOrEqual(11)
    // Baseline plus a descender stays inside the header block.
    expect(head.labelYs[1] + 3).toBeLessThanOrEqual(HEADER_BLOCK_H)
    expect(head.half * 2).toBeGreaterThanOrEqual(head.name.width)
    const svg = participantLabelSvg(head, head.name)
    expect(svg.match(/<tspan /g)).toHaveLength(2)
    expect(svg).toContain(ELLIPSIS)
  })

  it('puts two-line names inside a taller box, cylinder and queue', () => {
    const box = participantHeadFor({ type: 'PARTICIPANT', name: LONG })
    expect(box.shapeSvg).toContain('height="40"')
    const [top, bottom] = [8, 48]
    expect(box.labelYs[0] - 9).toBeGreaterThanOrEqual(top)
    expect(box.labelYs[1] + 3).toBeLessThanOrEqual(bottom)
    expect(participantHeadFor({ type: 'DATABASE', name: LONG }).shapeSvg).toContain('v34')
    expect(participantHeadFor({ type: 'QUEUE', name: LONG }).shapeSvg).toMatch(/,50 /)
    expect(participantHeadFor({ type: 'ACTOR', name: LONG }).shapeSvg).toContain('scale(0.8)')
  })
})

function people(names: string[], type: ParticipantType = 'PARTICIPANT'): Participant[] {
  return names.map((name, i) => ({ id: `p${i}`, name, type }))
}

describe('lanes', () => {
  it('keep the fixed gap for names that fit', () => {
    expect(laneCentres(people(['Api', 'Orders', 'Db']))).toEqual([LEFT_PAD, LEFT_PAD + COL_GAP, LEFT_PAD + 2 * COL_GAP])
  })

  it('move apart so wide neighbours keep a clear gap', () => {
    for (const type of TYPES) {
      const visible = people(['Api', MEDIUM, LONG, 'Db'], type)
      const xs = laneCentres(visible)
      const halves = visible.map((p) => participantHeadFor(p).half)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(Math.max(COL_GAP, halves[i - 1] + halves[i] + LANE_GAP))
      }
    }
  })

  it('pad the frame when a wide shape sits on an outer lifeline', () => {
    const pads = diagramPads([], people([LONG, 'Api', LONG]))
    const half = participantHeadFor({ type: 'PARTICIPANT', name: LONG }).half
    expect(pads.left).toBeGreaterThanOrEqual(Math.ceil(half - LEFT_PAD + 8))
    expect(pads.right).toBeGreaterThan(0)
    expect(diagramPads([], people(['Api', 'Db']))).toEqual({ left: 0, right: 0 })
  })
})

describe('sequence header with long names', () => {
  const scenario: Scenario = {
    id: 'long-names',
    title: 'Long names',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants: [
      { id: 'a', name: 'Customer', alias: 'Signed-in Customer (mobile app)', type: 'ACTOR' },
      { id: 'b', name: LONG, type: 'PARTICIPANT' },
      { id: 'c', name: MEDIUM, type: 'DATABASE' },
    ],
    events: [
      { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'hello', type: 'SYNCHRONOUS' },
      { kind: 'message', id: 'm2', from: 'b', to: 'c', label: 'save', type: 'SYNCHRONOUS' },
    ],
  }

  it('keeps the full name in the title and accessible name, and lifelines under the shapes', () => {
    document.body.innerHTML = `<div id="root">${renderDiagramHtml(scenario)}</div>`
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 })
    bindDiagramScroll(document.getElementById('root')!)
    syncDiagramWindow(scroll)
    const header = document.querySelector('.seq-header-svg')!
    expect(header.getAttribute('aria-label')).toContain(LONG)
    expect(header.getAttribute('aria-label')).toContain('Signed-in Customer (mobile app)')
    const box = header.querySelector('[data-participant="b"]')!
    expect(box.querySelector('title')!.textContent).toBe(`${LONG}, component`)
    expect(box.querySelectorAll('tspan')).toHaveLength(2)
    const headerX = [...header.querySelectorAll('.participant-box')].map((g) =>
      Number(/translate\(([\d.]+)/.exec(g.getAttribute('transform')!)![1]),
    )
    const lifelineX = [...document.querySelectorAll('.lifeline-line')].map((l) => Number(l.getAttribute('x1')))
    expect(lifelineX).toEqual(headerX)
    expect(headerX[1] - headerX[0]).toBeGreaterThan(COL_GAP)
  })
})

describe('component diagram with long names', () => {
  const scenario = {
    participants: [
      { id: 'a', name: LONG, type: 'PARTICIPANT' as const },
      { id: 'b', name: MEDIUM, type: 'DATABASE' as const },
      { id: 'c', name: 'Kafka topic order-events.v2 dead letters', type: 'QUEUE' as const },
      { id: 'd', name: 'Api', type: 'PARTICIPANT' as const },
    ],
    events: [
      { kind: 'message' as const, id: 'm1', from: 'd', to: 'a', label: 'x', type: 'SYNCHRONOUS' as const },
      { kind: 'message' as const, id: 'm2', from: 'd', to: 'b', label: 'y', type: 'SYNCHRONOUS' as const },
      { kind: 'message' as const, id: 'm3', from: 'd', to: 'c', label: 'z', type: 'ASYNCHRONOUS' as const },
    ],
  }

  it('wraps and cuts names like the header, keeps the full name in the title, and spaces nodes apart', () => {
    const graph = componentGraph(scenario)
    const host = document.createElement('div')
    host.innerHTML = renderComponentDiagram(graph, 'Long').svg
    const node = host.querySelector('[data-component="a"]')!
    expect(node.querySelector('title')!.textContent).toBe(`${LONG}, component`)
    expect([...node.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(fitName(LONG).lines)

    const { places, ranks } = layoutComponents(graph)
    const row = ranks[1]
    const halves = row.map((id) => participantHeadFor(graph.nodes.find((n) => n.id === id)!).half)
    for (let i = 1; i < row.length; i++) {
      const gap = places.get(row[i])!.x - places.get(row[i - 1])!.x
      expect(gap).toBeGreaterThan(halves[i - 1] + halves[i])
    }
  })
})
