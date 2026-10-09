import { componentEdgeCaption, type ComponentEdge, type ComponentGraph, type ComponentNode } from './component-graph'
import { participantHeadFor, participantLabelSvg } from './sequence-diagram'

/** Horizontal room per node. The participant shape is about 100 wide; the rest is for the name. */
export const SLOT_W = 150
/** Shape plus a name underneath, in header units (the same shapes as the sequence header). */
const NODE_H = 56
const GAP_X = 36
const GAP_Y = 84
const PAD = 20
/** Rough glyph width for 11px labels. Only used to keep captions inside the viewBox. */
const CHAR_W = 6.2
const LABEL_MAX = 34
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

/** SVG for the inspector panel. Edge type is spelled out in text and markers, never colour alone. */
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

  const obstacles: Rect[] = []
  const nodes = graph.nodes.map((node) => nodeSvg(node, places.get(node.id)!, grow, obstacles)).join('')
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]))
  // Edges stop at the shape, which is wider for a long name in a box, cylinder or queue.
  const heads = new Map(graph.nodes.map((node) => [node.id, participantHeadFor(node)]))
  const clipHalf = new Map([...heads].map(([id, head]) => [id, Math.max(HIT_HW, head.shapeHalf + 4)]))
  // A self-call loop also clears a long name under an actor, entity or boundary mark.
  const loopHalf = new Map([...heads].map(([id, head]) => [id, Math.max(HIT_HW, head.half + 4)]))
  const drawn = graph.edges.map((edge) => edgeSvg(edge, places, graph.edges, names, clipHalf, loopHalf))
  // Every edge has a caption (the type cue at least), so labels line up with edges by index.
  const labels = placeLabels(
    drawn.map((edge) => edge.label),
    obstacles,
  )
  for (const edge of drawn) grow(edge.bounds.minX, edge.bounds.minY, edge.bounds.maxX, edge.bounds.maxY)
  for (const label of labels) {
    const r = labelRect(label)
    grow(r.x, r.y, r.x + r.w, r.y + r.h)
  }
  const edges = drawn
    .map((edge, i) => {
      const label = labels[i]
      return `${edge.open}
      ${edge.path}
      <text class="edge-label" x="${fmt(label.x)}" y="${fmt(label.y)}" text-anchor="${label.anchor}">${escapeXml(label.text)}</text>
    </g>`
    })
    .join('')

  const vx = Math.floor(box.minX - PAD)
  const vy = Math.floor(box.minY - PAD)
  const width = Math.ceil(box.maxX + PAD) - vx
  const height = Math.ceil(box.maxY + PAD) - vy
  const svg = `<svg class="component-diagram" xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${width} ${height}" width="${width}" height="${height}" style="max-width:${width}px" role="img" aria-label="${escapeXml(summary)}">
    <title>${escapeXml(summary)}</title>
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
  obstacles: Rect[],
): string {
  // Names sit inside the box, cylinder, and queue; under the actor, entity, and boundary marks.
  // Long names widen the shape, then wrap to two lines and end in an ellipsis.
  const head = participantHeadFor(node)
  const half = Math.max(HIT_HW, head.half)
  const bottom = Math.max(48, head.labelYs[head.labelYs.length - 1] + 6)
  grow(at.x - half, at.y, at.x + half, at.y + bottom)
  obstacles.push({ x: at.x - half, y: at.y, w: half * 2, h: bottom })
  const colour = node.colour ? ` style="--pc:${escapeXml(node.colour)}"` : ''
  return `<g class="component-node participant-box" data-component="${escapeXml(node.id)}" data-participant-type="${head.type}" transform="translate(${fmt(at.x)}, ${fmt(at.y)})"${colour}>
      <title>${escapeXml(node.name)}, ${head.typeLabel}</title>
      ${head.shape}
      ${participantLabelSvg(head, head.name)}
    </g>`
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface EdgeLabel {
  x: number
  /** Baseline. */
  y: number
  anchor: 'start' | 'middle' | 'end'
  text: string
}

interface DrawnEdge {
  open: string
  path: string
  label: EdgeLabel
  bounds: Box
}

const LABEL_H = 14

function labelRect(label: EdgeLabel): Rect {
  const w = label.text.length * CHAR_W
  const x = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - w : label.x - w / 2
  return { x, y: label.y - LABEL_H + 3, w, h: LABEL_H }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Greedy, in edge order: a caption that would cover an earlier caption or a component
 * slides down a line at a time, then up, until it is clear. Gives up after a few lines
 * and keeps its first spot, which is no worse than not trying.
 */
export function placeLabels(labels: EdgeLabel[], obstacles: Rect[]): EdgeLabel[] {
  const taken: Rect[] = [...obstacles]
  return labels.map((label) => {
    const offsets = [0, 1, -1, 2, -2, 3, -3].map((n) => n * (LABEL_H + 1))
    for (const dy of offsets) {
      const moved = { ...label, y: label.y + dy }
      const rect = labelRect(moved)
      if (taken.some((other) => overlaps(rect, other))) continue
      taken.push(rect)
      return moved
    }
    taken.push(labelRect(label))
    return label
  })
}

function edgeSvg(
  edge: ComponentEdge,
  places: Map<string, NodePlace>,
  all: ComponentEdge[],
  names: Map<string, string>,
  clipHalf: Map<string, number>,
  loopHalf: Map<string, number>,
): DrawnEdge {
  const from = places.get(edge.from)!
  const to = places.get(edge.to)!
  const full = componentEdgeCaption(edge)
  const text = abbreviate(full, LABEL_MAX)
  const style = edgeStyle(edge)
  const title = `${names.get(edge.from) ?? edge.from} to ${names.get(edge.to) ?? edge.to}: ${full}`
  const open = `<g class="edge-group" data-edge-from="${escapeXml(edge.from)}" data-edge-to="${escapeXml(edge.to)}">
      <title>${escapeXml(title)}</title>`

  if (edge.from === edge.to) {
    // Loop on the right of the shape, caption beside it.
    const x = from.x + (loopHalf.get(edge.from) ?? HIT_HW)
    const cy = from.y + HIT_CY
    const d = `M ${fmt(x)} ${fmt(cy - 10)} C ${fmt(x + 46)} ${fmt(cy - 34)}, ${fmt(x + 46)} ${fmt(cy + 34)}, ${fmt(x)} ${fmt(cy + 10)}`
    return {
      open,
      path: `<path d="${d}" class="${style.cls}"${style.start} marker-end="url(#${style.end})"/>`,
      label: { x: x + 42, y: cy + 4, anchor: 'start', text },
      bounds: { minX: x, minY: cy - 30, maxX: x + 40, maxY: cy + 30 },
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
  const midX = (start[0] + end[0]) / 2
  const midY = (start[1] + end[1]) / 2
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  // Which side of the centre line this edge was moved to (0 when it was not moved).
  const sideX = midX - (x1 + x2) / 2
  const sideY = midY - (y1 + y2) / 2
  let label: EdgeLabel
  if (Math.abs(dy) >= Math.abs(dx)) {
    // Mostly vertical: the caption sits to one side. A reverse pair puts its captions left and
    // right; a lone edge puts its caption on the outside of the way it leans.
    const right = shift ? sideX >= 0 : dx >= 0
    label = { x: midX + (right ? 8 : -8), y: midY + 4, anchor: right ? 'start' : 'end', text }
  } else {
    // Mostly horizontal: above for one direction, below for the other.
    label = { x: midX, y: midY + (sideY <= 0 ? -6 : 14), anchor: 'middle', text }
  }
  return {
    open,
    path: `<line class="${style.cls}" x1="${fmt(start[0])}" y1="${fmt(start[1])}" x2="${fmt(end[0])}" y2="${fmt(end[1])}"${style.start} marker-end="url(#${style.end})"/>`,
    label,
    bounds: {
      minX: Math.min(start[0], end[0]),
      minY: Math.min(start[1], end[1]),
      maxX: Math.max(start[0], end[0]),
      maxY: Math.max(start[1], end[1]),
    },
  }
}

/** Same cues as the sequence arrows: async is dashed with an open head, lost ends in a cross. */
function edgeStyle(edge: ComponentEdge): { cls: string; start: string; end: string } {
  if (edge.types.length !== 1) return { cls: 'edge edge-mixed', start: '', end: 'lsd-comp-mixed' }
  switch (edge.types[0]) {
    case 'ASYNCHRONOUS':
      return { cls: 'edge edge-async', start: '', end: 'lsd-comp-open' }
    case 'BI_DIRECTIONAL':
      return { cls: 'edge', start: ' marker-start="url(#lsd-comp-filled)"', end: 'lsd-comp-filled' }
    case 'LOST':
      return { cls: 'edge', start: '', end: 'lsd-comp-lost' }
    default:
      return { cls: 'edge', start: '', end: 'lsd-comp-filled' }
  }
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

function abbreviate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, Math.max(0, max - 1)) + '…'
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
