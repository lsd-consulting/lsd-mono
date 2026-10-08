import type { Scenario } from '../types'

/**
 * Message types that are a dependency from caller to callee.
 * Responses run back along an existing edge, and short arrows have no far end, so neither is an edge.
 */
export const COMPONENT_EDGE_TYPES: ReadonlySet<string> = new Set([
  'SYNCHRONOUS',
  'ASYNCHRONOUS',
  'BI_DIRECTIONAL',
  'LOST',
])

export interface ComponentNode {
  id: string
  /** Display name: the participant alias, else its name, else the raw id. */
  name: string
  /** Captured participant type. `PARTICIPANT` when the id is not in the participant list. */
  type: string
  colour?: string
}

export interface ComponentEdge {
  from: string
  to: string
  /** Distinct included message types, first-seen order. */
  types: string[]
  /** Messages folded into this edge. */
  count: number
  /** First non-empty label on this from-to pair. */
  label?: string
}

export interface ComponentGraph {
  nodes: ComponentNode[]
  edges: ComponentEdge[]
}

/**
 * Built in the browser from one scenario's captured messages; nothing is precomputed on the JVM.
 * Nodes are participants on at least one included message, in first-seen order.
 * Names, types, and colours come from the captured participant list when that id is known.
 * Duplicate from-to pairs collapse into one edge that keeps a count and the first label.
 */
export function componentGraph(scenario: Pick<Scenario, 'participants' | 'events'>): ComponentGraph {
  const known = new Map(scenario.participants.map((participant) => [participant.id, participant]))
  type Acc = { from: string; to: string; types: string[]; count: number; label?: string }
  const edges = new Map<string, Acc>()
  const nodeIds: string[] = []
  const seen = new Set<string>()

  for (const event of scenario.events) {
    if (event.kind !== 'message') continue
    if (!COMPONENT_EDGE_TYPES.has(event.type)) continue
    const from = event.from.trim()
    const to = event.to.trim()
    if (!from || !to) continue
    const key = JSON.stringify([from, to])
    let acc = edges.get(key)
    if (!acc) {
      acc = { from, to, types: [], count: 0 }
      edges.set(key, acc)
    }
    if (!acc.types.includes(event.type)) acc.types.push(event.type)
    acc.count += 1
    const label = event.label.trim()
    if (!acc.label && label) acc.label = label
    for (const id of [from, to]) {
      if (seen.has(id)) continue
      seen.add(id)
      nodeIds.push(id)
    }
  }

  return {
    nodes: nodeIds.map((id) => {
      const participant = known.get(id)
      return {
        id,
        name: participant?.alias ?? participant?.name ?? id,
        type: participant?.type ?? 'PARTICIPANT',
        ...(participant?.colour ? { colour: participant.colour } : {}),
      }
    }),
    edges: [...edges.values()].map(({ from, to, types, count, label }) => ({
      from,
      to,
      types,
      count,
      ...(label ? { label } : {}),
    })),
  }
}

/** True when at least one message would draw an edge. Cheaper than building the graph. */
export function hasComponentDiagram(scenario: Pick<Scenario, 'events'>): boolean {
  return scenario.events.some(
    (event) =>
      event.kind === 'message' &&
      COMPONENT_EDGE_TYPES.has(event.type) &&
      event.from.trim() !== '' &&
      event.to.trim() !== '',
  )
}

export function typeCue(type: string): string {
  switch (type) {
    case 'SYNCHRONOUS':
      return 'sync'
    case 'ASYNCHRONOUS':
      return 'async'
    case 'BI_DIRECTIONAL':
      return 'bi'
    case 'LOST':
      return 'lost'
    default:
      return type.toLowerCase()
  }
}

/**
 * Text cue for an edge, so the type is never colour or marker alone.
 * `place order · sync`, `publish · async ×3`, or `sync, async ×2` when nothing was labelled.
 */
export function componentEdgeCaption(edge: ComponentEdge): string {
  const cue = edge.types.length ? edge.types.map(typeCue).join(', ') : 'edge'
  const counted = edge.count > 1 ? `${cue} ×${edge.count}` : cue
  return edge.label ? `${edge.label} · ${counted}` : counted
}
