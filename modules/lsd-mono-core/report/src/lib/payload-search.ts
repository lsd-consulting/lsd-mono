// Find in message payloads (#60). Each payload is searched as the text the side panel shows,
// folded to lower case once, so a match is also a place in that text. Indexing and searching run
// in short slices, so typing never waits on a large report.
import { pretty } from '../ui/format'

/** Longest a slice of indexing or searching runs before it gives the page back. */
export const SLICE_MS = 8

/** Most matches highlighted in one payload. The rest are counted. */
export const MARK_LIMIT = 1000

/** Most matches counted in one payload, so a one-letter query on a huge payload stays cheap. */
export const COUNT_LIMIT = 100_000

/** The text the side panel shows for a payload: a string as it is, anything else as indented JSON. */
export function payloadText(value: unknown): string {
  return typeof value === 'string' ? value : pretty(value)
}

/**
 * Lower case with one UTF-16 unit for one, so an offset in the folded text is the same offset in
 * the original. Lower-casing never shortens text, so equal length means every character kept its
 * length. A character that grows (İ) stays as it is.
 */
export function foldCase(text: string): string {
  const lower = text.toLowerCase()
  if (lower.length === text.length) return lower
  let out = ''
  for (const ch of text) {
    const folded = ch.toLowerCase()
    out += folded.length === ch.length ? folded : ch
  }
  return out
}

/** Find's query as payloads are searched: trimmed and folded. Empty means no search. */
export function foldQuery(query: string): string {
  return foldCase(query.trim())
}

/** One payload ready to search: the message it belongs to and its folded text. */
export interface PayloadEntry {
  id: string
  text: string
}

/** A payload to index: the message id and the value the side panel would show. */
export interface PayloadSource {
  id: string
  value: unknown
}

/** Where matches start in [folded], up to [limit] of them, and how many there are up to COUNT_LIMIT. */
export function matchOffsets(folded: string, query: string, limit = MARK_LIMIT): { offsets: number[]; total: number } {
  const offsets: number[] = []
  let total = 0
  if (!query) return { offsets, total }
  let at = folded.indexOf(query)
  while (at !== -1 && total < COUNT_LIMIT) {
    if (offsets.length < limit) offsets.push(at)
    total++
    at = folded.indexOf(query, at + query.length)
  }
  return { offsets, total }
}

/** How sliced work tells time and comes back later. The page uses the clock and a macrotask. */
export interface Slicer {
  now: () => number
  later: (resume: () => void) => void
  budgetMs: number
}

export const pageSlicer: Slicer = {
  now: () => performance.now(),
  later: (resume) => setTimeout(resume, 0),
  budgetMs: SLICE_MS,
}

/**
 * Run [work] in slices of at most [slicer].budgetMs, giving the page back between them. Stops
 * without calling [onDone] once [cancelled] says so. Returns true when the work finished in this
 * call, so a small report gets its answer before the keystroke's handler returns.
 */
export function runSliced(
  work: Iterator<unknown>,
  slicer: Slicer,
  cancelled: () => boolean,
  onDone: () => void,
): boolean {
  const slice = (): boolean => {
    if (cancelled()) return false
    const end = slicer.now() + slicer.budgetMs
    for (;;) {
      if (work.next().done) {
        onDone()
        return true
      }
      if (slicer.now() >= end) {
        slicer.later(() => void slice())
        return false
      }
    }
  }
  return slice()
}

/** Index [sources] into [into], one payload per step. A payload with nothing to show is left out. */
export function* indexPayloads(sources: readonly PayloadSource[], into: PayloadEntry[]): Generator<void> {
  for (const source of sources) {
    if (source.value !== undefined && source.value !== null) {
      into.push({ id: source.id, text: foldCase(payloadText(source.value)) })
    }
    yield
  }
}

/**
 * Collect into [hits] the ids of [entries] whose text contains [query] (already folded), one
 * payload per step. With [within], only those ids are looked at: a query that extends the last one
 * can only match where the last one did.
 */
export function* searchPayloads(
  entries: readonly PayloadEntry[],
  query: string,
  hits: Set<string>,
  within: ReadonlySet<string> | null = null,
): Generator<void> {
  for (const entry of entries) {
    if ((!within || within.has(entry.id)) && entry.text.includes(query)) hits.add(entry.id)
    yield
  }
}
