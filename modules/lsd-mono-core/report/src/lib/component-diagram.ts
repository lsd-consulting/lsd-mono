import { componentEdgeTitle, type ComponentEdge, type ComponentGraph, type ComponentNode } from './component-graph'
import { participantHeadFor, participantLabelSvg } from './sequence-diagram'
import { escapeAttr, escapeHtml } from './escape'

/** Horizontal room per node. The participant shape is about 100 wide; the rest is for the name. */
export const SLOT_W = 150
/** Shape plus a name underneath, in header units (the same shapes as the sequence header). */
const NODE_H = 56
const GAP_X = 36
const GAP_Y = 84
const PAD = 20
/** Count badge: digit width at 10px, height, and how far along its link it sits. */
const BADGE_DIGIT_W = 6.4
const BADGE_H = 16
/** Short of halfway, so the badges on an opposing pair do not sit on top of each other. */
const BADGE_AT = 0.42
/** Edge clip box around a shape, centred on the shape rather than the name under it. */
const HIT_HW = 52
const HIT_HH = 24
const HIT_CY = 26

export interface NodePlace {
  /** Centre x of the shape. */
  x: number
  /** Top of the node, in the same units as the participant header. */
  y: number
  rank: number
}

export interface ComponentLayout {
  places: Map<string, NodePlace>
  /** Rows top to bottom. Callers sit above the components they call. */
  ranks: string[][]
}

export interface ComponentDiagram {
  svg: string
  /** Natural size of the drawing, in CSS pixels. */
  width: number
  height: number
}

/**
 * Callers above callees. Rank is the longest path from a component nothing calls,
 * after dropping the edges that close a cycle (found depth-first in first-seen order).
 * Each row is ordered by the mean x of the row above (one barycentre pass), then centred.
 */
export function layoutComponents(graph: ComponentGraph): ComponentLayout {
  const ids = graph.nodes.map((node) => node.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue
    if (!index.has(edge.from) || !index.has(edge.to)) continue
    const next = out.get(edge.from)!
    if (!next.includes(edge.to)) next.push(edge.to)
  }

  const forward = new Map<string, string[]>(ids.map((id) => [id, []]))
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string): void => {
    state.set(id, 'open')
    for (const to of out.get(id)!) {
      const seen = state.get(to)
      if (seen === 'open') continue
      forward.get(id)!.push(to)
      if (!seen) visit(to)
    }
    state.set(id, 'done')
  }
  for (const id of ids) if (!state.has(id)) visit(id)

  const indegree = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const targets of forward.values()) for (const to of targets) indegree.set(to, indegree.get(to)! + 1)
  const rank = new Map<string, number>(ids.map((id) => [id, 0]))
  const queue = ids.filter((id) => indegree.get(id) === 0)
  while (queue.length) {
    const id = queue.shift()!
    for (const to of forward.get(id)!) {
      rank.set(to, Math.max(rank.get(to)!, rank.get(id)! + 1))
      indegree.set(to, indegree.get(to)! - 1)
      if (indegree.get(to) === 0) queue.push(to)
    }
  }

  const ranks: string[][] = []
  for (const id of ids) (ranks[rank.get(id)!] ??= []).push(id)

  const places = new Map<string, NodePlace>()
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const [from, targets] of forward) for (const to of targets) parents.get(to)!.push(from)
  const widest = Math.max(...ranks.map((row) => row.length))
  // Slots widen together for a long name, so wide nodes never touch their neighbours.
  const slot = Math.max(SLOT_W, ...graph.nodes.map((node) => Math.ceil(participantHeadFor(node).half * 2)))
  const rowWidth = (count: number) => count * slot + (count - 1) * GAP_X
  const full = rowWidth(widest)
  ranks.forEach((row, r) => {
    if (r > 0) {
      const centre = (id: string): number => {
        const xs = parents.get(id)!.flatMap((p) => (places.has(p) ? [places.get(p)!.x] : []))
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY
      }
      row.sort((a, b) => centre(a) - centre(b) || index.get(a)! - index.get(b)!)
    }
    const left = (full - rowWidth(row.length)) / 2
    row.forEach((id, i) => {
      places.set(id, { x: left + i * (slot + GAP_X) + slot / 2, y: r * (NODE_H + GAP_Y), rank: r })
    })
  })
  return { places, ranks }
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * SVG for the inspector panel. Edge type is in the line (solid or dashed) and the arrow head,
 * never colour alone. Each link is a focusable group whose title lists its interactions.
 */
export function renderComponentDiagram(graph: ComponentGraph, title: string): ComponentDiagram {
  const summary = `${title} component diagram, ${count(graph.nodes.length, 'component')}, ${count(graph.edges.length, 'link')}`
  if (graph.nodes.length === 0) {
    return {
      width: 240,
      height: 48,
      svg: `<svg class="component-diagram" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 48" width="240" height="48" role="img" aria-label="Nothing to draw">
      <title>Nothing to draw</title>
      <text class="empty" x="8" y="28">No messages between components.</text>
    </svg>`,
    }
  }
  const { places } = layoutComponents(graph)
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const grow = (x1: number, y1: number, x2: number, y2: number): void => {
    box.minX = Math.min(box.minX, x1)
    box.minY = Math.min(box.minY, y1)
    box.maxX = Math.max(box.maxX, x2)
    box.maxY = Math.max(box.maxY, y2)
  }

  const nodes = graph.nodes.map((node) => nodeSvg(node, places.get(node.id)!, grow)).join('')
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]))
  // Edges stop at the shape, which is wider for a long name in a box, cylinder or queue.
  const heads = new Map(graph.nodes.map((node) => [node.id, participantHeadFor(node)]))
  const clipHalf = new Map([...heads].map(([id, head]) => [id, Math.max(HIT_HW, head.shapeHalf + 4)]))
  // A self-call loop also clears a long name under an actor, entity or boundary mark.
  const loopHalf = new Map([...heads].map(([id, head]) => [id, Math.max(HIT_HW, head.half + 4)]))
  // No captions on links, so a busy pair of components stays readable. The type is in the
  // line and the head, a badge counts a link with more than one message, and the hover
  // title (and the side panel, on click) lists the messages.
  const drawn = graph.edges.map((edge, i) => edgeSvg(edge, i, places, graph.edges, names, clipHalf, loopHalf))
  for (const edge of drawn) grow(edge.bounds.minX, edge.bounds.minY, edge.bounds.maxX, edge.bounds.maxY)
  const edges = drawn.map((edge) => edge.svg).join('')

  const vx = Math.floor(box.minX - PAD)
  const vy = Math.floor(box.minY - PAD)
  const width = Math.ceil(box.maxX + PAD) - vx
  const height = Math.ceil(box.maxY + PAD) - vy
  const svg = `<svg class="component-diagram" xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${width} ${height}" width="${width}" height="${height}" style="max-width:${width}px" role="group" aria-label="${escapeAttr(summary)}">
    <title>${escapeHtml(summary)}</title>
    <defs>
      <marker id="lsd-comp-filled" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="9" refY="5" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 Z" class="marker-fill"/>
      </marker>
      <marker id="lsd-comp-open" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="9" refY="5" orient="auto-start-reverse">
        <path d="M1 1 L9 5 L1 9" class="marker-open"/>
      </marker>
      <marker id="lsd-comp-lost" viewBox="0 0 12 12" markerWidth="10" markerHeight="10" refX="10" refY="6" orient="auto">
        <path d="M2 2 L10 10 M10 2 L2 10" class="marker-open"/>
      </marker>
      <marker id="lsd-comp-mixed" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="9" refY="5" orient="auto">
        <path d="M4 0 L10 5 L4 10 L-2 5 Z" class="marker-open"/>
      </marker>
    </defs>
    <g class="edges">${edges}</g>
    <g class="nodes">${nodes}</g>
  </svg>`
  return { svg, width, height }
}

/** String-only form for callers that do not need the natural size. */
export function renderComponentSvg(graph: ComponentGraph, title: string): string {
  return renderComponentDiagram(graph, title).svg
}

function nodeSvg(
  node: ComponentNode,
  at: NodePlace,
  grow: (x1: number, y1: number, x2: number, y2: number) => void,
): string {
  // Names sit inside the box, cylinder, and queue; under the actor, entity, and boundary marks.
  // Long names widen the shape, then wrap to two lines and end in an ellipsis.
  const head = participantHeadFor(node)
  const half = Math.max(HIT_HW, head.half)
  const bottom = Math.max(48, head.labelYs[head.labelYs.length - 1] + 6)
  grow(at.x - half, at.y, at.x + half, at.y + bottom)
  const colour = node.colour ? ` style="--pc:${escapeAttr(node.colour)}"` : ''
  return `<g class="component-node participant-box" data-component="${escapeAttr(node.id)}" data-participant-type="${head.type}" transform="translate(${fmt(at.x)}, ${fmt(at.y)})"${colour}>
      <title>${escapeHtml(node.name)}, ${head.typeLabel}</title>
      ${head.shapeSvg}
      ${participantLabelSvg(head, head.name)}
    </g>`
}

interface DrawnEdge {
  svg: string
  bounds: Box
}

/** Small pill with the number of messages on a link, centred on (x, y). */
function badgeSvg(count: number, x: number, y: number): { svg: string; bounds: Box } {
  const text = String(count)
  const w = Math.max(BADGE_H, 8 + text.length * BADGE_DIGIT_W)
  const h = BADGE_H
  return {
    svg: `<g class="edge-badge" transform="translate(${fmt(x)}, ${fmt(y)})" aria-hidden="true"><rect x="${fmt(-w / 2)}" y="${fmt(-h / 2)}" width="${fmt(w)}" height="${h}" rx="${h / 2}"/><text x="0" y="3.5" text-anchor="middle">${text}</text></g>`,
    bounds: { minX: x - w / 2, minY: y - h / 2, maxX: x + w / 2, maxY: y + h / 2 },
  }
}

function union(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

function edgeSvg(
  edge: ComponentEdge,
  index: number,
  places: Map<string, NodePlace>,
  all: ComponentEdge[],
  names: Map<string, string>,
  clipHalf: Map<string, number>,
  loopHalf: Map<string, number>,
): DrawnEdge {
  const from = places.get(edge.from)!
  const to = places.get(edge.to)!
  const style = edgeStyle(edge)
  const fromName = names.get(edge.from) ?? edge.from
  const toName = names.get(edge.to) ?? edge.to
  const title = componentEdgeTitle(edge, fromName, toName)
  const label = `${fromName} to ${toName}, ${edge.count} ${edge.count === 1 ? 'interaction' : 'interactions'}`
  const group = (shapeSvg: string, hitSvg: string, countSvg: string): string =>
    `<g class="edge-group" data-edge-index="${index}" data-edge-from="${escapeAttr(edge.from)}" data-edge-to="${escapeAttr(edge.to)}" tabindex="0" role="button" aria-label="${escapeAttr(label)}">
      <title>${escapeHtml(title)}</title>
      ${hitSvg}
      ${shapeSvg}
      ${countSvg}
    </g>`

  if (edge.from === edge.to) {
    // Loop on the right of the shape.
    const x = from.x + (loopHalf.get(edge.from) ?? HIT_HW)
    const cy = from.y + HIT_CY
    const d = `M ${fmt(x)} ${fmt(cy - 10)} C ${fmt(x + 46)} ${fmt(cy - 34)}, ${fmt(x + 46)} ${fmt(cy + 34)}, ${fmt(x)} ${fmt(cy + 10)}`
    let bounds: Box = { minX: x, minY: cy - 30, maxX: x + 40, maxY: cy + 30 }
    let badge = ''
    if (edge.count > 1) {
      const drawn = badgeSvg(edge.count, x + 35, cy)
      badge = drawn.svg
      bounds = union(bounds, drawn.bounds)
    }
    return {
      svg: group(
        `<path d="${d}" class="${style.cls}"${edgeMarkers(style)}/>`,
        `<path d="${d}" class="edge-hit"/>`,
        badge,
      ),
      bounds,
    }
  }

  const reverse = all.some((other) => other.from === edge.to && other.to === edge.from)
  // An opposing pair splits so neither hides the other. The sideways offset follows the
  // direction of travel, so the same sign puts the two edges on opposite sides.
  const shift = reverse ? 8 : 0
  const x1 = from.x
  const y1 = from.y + HIT_CY
  const x2 = to.x
  const y2 = to.y + HIT_CY
  const start = clip(x1, y1, x2, y2, shift, clipHalf.get(edge.from) ?? HIT_HW)
  const end = clip(x2, y2, x1, y1, -shift, clipHalf.get(edge.to) ?? HIT_HW)
  let bounds: Box = {
    minX: Math.min(start[0], end[0]),
    minY: Math.min(start[1], end[1]),
    maxX: Math.max(start[0], end[0]),
    maxY: Math.max(start[1], end[1]),
  }
  let badge = ''
  if (edge.count > 1) {
    const drawn = badgeSvg(
      edge.count,
      start[0] + (end[0] - start[0]) * BADGE_AT,
      start[1] + (end[1] - start[1]) * BADGE_AT,
    )
    badge = drawn.svg
    bounds = union(bounds, drawn.bounds)
  }
  const coords = `x1="${fmt(start[0])}" y1="${fmt(start[1])}" x2="${fmt(end[0])}" y2="${fmt(end[1])}"`
  return {
    svg: group(
      `<line class="${style.cls}" ${coords}${edgeMarkers(style)}/>`,
      `<line class="edge-hit" ${coords}/>`,
      badge,
    ),
    bounds,
  }
}

/** Same cues as the sequence arrows: async is dashed with an open head, lost ends in a cross. */
type EdgeMarker = 'lsd-comp-mixed' | 'lsd-comp-open' | 'lsd-comp-filled' | 'lsd-comp-lost'

interface EdgeStyle {
  cls: 'edge' | 'edge edge-async' | 'edge edge-mixed'
  start?: EdgeMarker
  end: EdgeMarker
}

function edgeStyle(edge: ComponentEdge): EdgeStyle {
  if (edge.types.length !== 1) return { cls: 'edge edge-mixed', end: 'lsd-comp-mixed' }
  switch (edge.types[0]) {
    case 'ASYNCHRONOUS':
      return { cls: 'edge edge-async', end: 'lsd-comp-open' }
    case 'BI_DIRECTIONAL':
      return { cls: 'edge', start: 'lsd-comp-filled', end: 'lsd-comp-filled' }
    case 'LOST':
      return { cls: 'edge', end: 'lsd-comp-lost' }
    default:
      return { cls: 'edge', end: 'lsd-comp-filled' }
  }
}

/** The path's marker attributes for [style]. */
function edgeMarkers(style: EdgeStyle): string {
  return `${style.start ? ` marker-start="url(#${style.start})"` : ''} marker-end="url(#${style.end})"`
}

/** Point where the segment from (cx, cy) towards (tx, ty), shifted sideways, leaves the node's clip box. */
function clip(cx: number, cy: number, tx: number, ty: number, shift: number, halfW: number): [number, number] {
  const dx = tx - cx
  const dy = ty - cy
  const len = Math.hypot(dx, dy) || 1
  const ox = (-dy / len) * shift
  const oy = (dx / len) * shift
  const sx = cx + ox
  const sy = cy + oy
  if (dx === 0 && dy === 0) return [sx, sy]
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : HIT_HH / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY)
  return [sx + dx * scale, sy + dy * scale]
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

