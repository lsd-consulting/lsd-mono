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

/** Messages on one link that share a label and a type. */
export interface ComponentInteraction {
  /** Message label, trimmed. Empty when the message had none. */
  label: string
  type: string
  count: number
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
  /** Every message on this link, grouped by label and type, first-seen order. */
  interactions?: ComponentInteraction[]
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
  type Acc = {
    from: string
    to: string
    types: string[]
    count: number
    label?: string
    interactions: ComponentInteraction[]
  }
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
      acc = { from, to, types: [], count: 0, interactions: [] }
      edges.set(key, acc)
    }
    if (!acc.types.includes(event.type)) acc.types.push(event.type)
    acc.count += 1
    const label = event.label.trim()
    if (!acc.label && label) acc.label = label
    const same = acc.interactions.find((item) => item.label === label && item.type === event.type)
    if (same) same.count += 1
    else acc.interactions.push({ label, type: event.type, count: 1 })
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
    edges: [...edges.values()].map(({ from, to, types, count, label, interactions }) => ({
      from,
      to,
      types,
      count,
      ...(label ? { label } : {}),
      interactions,
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

/** Interactions on a link. Edges built by hand without them fall back to the first label. */
export function edgeInteractions(edge: ComponentEdge): ComponentInteraction[] {
  if (edge.interactions?.length) return edge.interactions
  if (edge.types.length === 1) return [{ label: edge.label ?? '', type: edge.types[0], count: edge.count }]
  return [{ label: edge.label ?? '', type: edge.types.join(', '), count: edge.count }]
}

/** One interaction as text: `place order · sync`, `publish · async ×3`, `(no label) · sync`. */
export function interactionText(item: ComponentInteraction): string {
  const cue = item.type
    .split(', ')
    .map((type) => typeCue(type))
    .join(', ')
  const label = item.label.replace(/\s+/g, ' ').trim() || '(no label)'
  return `${label} · ${cue}${item.count > 1 ? ` ×${item.count}` : ''}`
}

/** Most interactions a hover title lists before it says how many more there are. */
export const TITLE_MAX_INTERACTIONS = 12

/**
 * Hover text for a link: who calls whom, how many messages, then one interaction per line.
 * `Orders to Orders DB, 3 interactions:` then `load basket · sync` and so on.
 */
export function componentEdgeTitle(edge: ComponentEdge, fromName: string, toName: string): string {
  const items = edgeInteractions(edge)
  const head = `${fromName} to ${toName}, ${edge.count} ${edge.count === 1 ? 'interaction' : 'interactions'}:`
  const lines = items.slice(0, TITLE_MAX_INTERACTIONS).map(interactionText)
  const rest = items.length - lines.length
  if (rest > 0) lines.push(`…and ${rest} more`)
  return [head, ...lines].join('\n')
}
