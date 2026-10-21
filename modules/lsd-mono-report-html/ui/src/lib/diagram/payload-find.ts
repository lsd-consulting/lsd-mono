// Find in payloads for one diagram (#60). The first time Find needs them (the field gets focus,
// or a query is typed), the scenario's payloads are loaded and indexed in slices; each query is
// then searched in slices, and a newer query stops an older search. A small report gets its
// answer before the keystroke's handler returns, so nothing flickers. Label and note matches
// stay synchronous (search-reveal.ts); this only adds the messages whose payload matched.
import type { MessageEvent, Scenario } from '../../types'
import { messageHasPayload } from '../diagram-a11y'
import { NO_PAYLOAD_HITS } from '../diagram-view'
import {
  type PayloadEntry,
  type PayloadSource,
  type Slicer,
  foldQuery,
  indexPayloads,
  pageSlicer,
  runSliced,
  searchPayloads,
} from '../payload-search'
import { payloadKey } from '../payloads'
import { diagramState, diagramView } from './state'

/** One scenario's payloads for Find: loading, then indexed, with the hits for the last query searched. */
export interface PayloadFind {
  phase: 'loading' | 'indexing' | 'ready' | 'failed'
  entries: PayloadEntry[]
  /** The folded query [hits] answers, or null before any search finished. */
  query: string | null
  hits: Set<string>
  /** The folded query Find wants answered next. */
  wanted: string
  /** Bumped by every search started, so an older one stops. */
  job: number
  /** Repaint the diagram's matches and count when an answer arrives after its keystroke. */
  onChange: () => void
}

/** The deferred payloads a scenario's messages point at, keyed by payloadKey. */
export type PayloadMapLoader = (scenario: Scenario) => Promise<Record<string, unknown>>

let loadMap: PayloadMapLoader = () => Promise.resolve({})
let slicer: Slicer = pageSlicer

/** Where payloads come from: the report's payload script, or the index page's one per report. */
export function setPayloadLoader(next: PayloadMapLoader): void {
  loadMap = next
}

/** Test hook: a fake clock and queue in place of the page's. */
export function setPayloadSlicer(next: Slicer | null): void {
  slicer = next ?? pageSlicer
}

/** What Find knows about payload matches for the view's query. */
export interface PayloadMatches {
  hits: ReadonlySet<string>
  /** Loading, indexing or searching for this query. */
  pending: boolean
  failed: boolean
}

const NONE: PayloadMatches = { hits: NO_PAYLOAD_HITS, pending: false, failed: false }

/** Payload matches for the scenario's query, from what is already searched. Never starts work. */
export function payloadMatches(scenarioId: string): PayloadMatches {
  const view = diagramView(scenarioId)
  const query = view.includePayloads ? foldQuery(view.query) : ''
  const find = diagramState.payloadFind.get(scenarioId)
  if (!query || !find) return NONE
  if (find.phase === 'failed') return { ...NONE, failed: true }
  if (find.phase === 'ready' && find.query === query) return { hits: find.hits, pending: false, failed: false }
  return { hits: NO_PAYLOAD_HITS, pending: true, failed: false }
}

function hasPayloads(scenario: Scenario): boolean {
  return scenario.events.some((event) => event.kind === 'message' && messageHasPayload(event))
}

/**
 * Bring payload matches up to date with the view's query: load and index the payloads the first
 * time, then search. [onChange] runs when an answer arrives after this call returns. Payload
 * searching off, or a scenario without payloads, does nothing.
 */
export function refreshPayloadFind(scenario: Scenario, onChange: () => void): void {
  const view = diagramView(scenario.id)
  if (!view.includePayloads || !hasPayloads(scenario)) return
  let find = diagramState.payloadFind.get(scenario.id)
  if (!find) {
    find = { phase: 'loading', entries: [], query: null, hits: new Set(), wanted: '', job: 0, onChange }
    diagramState.payloadFind.set(scenario.id, find)
    load(scenario, find)
  } else if (find.phase === 'failed') {
    load(scenario, find)
  }
  find.onChange = onChange
  find.wanted = foldQuery(view.query)
  if (find.phase === 'ready') search(find, false)
}

function current(scenarioId: string, find: PayloadFind): boolean {
  return diagramState.payloadFind.get(scenarioId) === find
}

function load(scenario: Scenario, find: PayloadFind): void {
  find.phase = 'loading'
  loadMap(scenario).then((map) => {
    if (!current(scenario.id, find)) return
    find.phase = 'indexing'
    find.entries = []
    runSliced(
      indexPayloads(payloadSources(scenario, map), find.entries),
      slicer,
      () => !current(scenario.id, find),
      () => {
        find.phase = 'ready'
        search(find, true)
      },
      fail,
    )
  }, fail)
  function fail(): void {
    if (!current(scenario.id, find)) return
    find.phase = 'failed'
    find.onChange()
  }
}

/**
 * Each message with a payload, and the value the side panel would show for it. Each payload is
 * read when indexing reaches it, not here: the payload script's map parses a payload on first
 * read (#63), so reading them all at once would be one long task.
 */
function payloadSources(scenario: Scenario, map: Record<string, unknown>): PayloadSource[] {
  return scenario.events
    .filter((event): event is MessageEvent => event.kind === 'message' && messageHasPayload(event))
    .map((msg) => ({
      id: msg.id,
      get value() {
        return msg.payloadId ? map[payloadKey(scenario.id, msg.id)] : msg.data
      },
    }))
}

/** Search for [find].wanted unless it is already answered. [notify] when the caller has returned. */
function search(find: PayloadFind, notify: boolean): void {
  const query = find.wanted
  if (find.query === query) {
    if (notify) find.onChange()
    return
  }
  const job = ++find.job
  if (!query) {
    find.query = query
    find.hits = new Set()
    if (notify) find.onChange()
    return
  }
  // A query that extends the last answered one can only match where that one did.
  const within = find.query && query.includes(find.query) ? find.hits : null
  const hits = new Set<string>()
  let inline = true
  runSliced(
    searchPayloads(find.entries, query, hits, within),
    slicer,
    () => find.job !== job,
    () => {
      find.query = query
      find.hits = hits
      if (notify || !inline) find.onChange()
    },
  )
  inline = false
}
