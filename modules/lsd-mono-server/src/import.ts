/** What an imported file is. Both kinds land as stored reports (#186). */
export type ImportKind = 'lsd-report' | 'otlp' | 'unknown'

/**
 * Tells an exported LSD report from an OTLP JSON export by its top-level keys.
 * TODO(#186): validate an LSD report against its schema; OTLP protobuf files are not handled yet.
 */
export function detectImport(body: string): ImportKind {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return 'unknown'
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return 'unknown'
  if ('resourceSpans' in json) return 'otlp'
  if ('schemaVersion' in json) return 'lsd-report'
  return 'unknown'
}

/** TODO(#186): map OTLP spans to an LSD report (#96), so it is stored like any other report. */
export function otlpToReport(): never {
  throw new Error('OTLP import is not implemented yet (#186)')
}
