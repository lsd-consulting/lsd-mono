/**
 * The report's place in the URL hash, so a link or a reload shows the same thing.
 * Hash only: file:// pages cannot rely on the History API or a server.
 *
 * Forms:
 * - `#scenario=<scenarioId>`: that scenario is shown.
 * - `#msg=<scenarioId>/<messageId>`: that scenario is shown and the message is open
 *   in the side panel.
 *
 * Ids are URI-encoded, so a slash in an id cannot split the token.
 */

export interface HashRef {
  scenarioId: string
  /** Set when a message is open. */
  messageId?: string
}

const MESSAGE = '#msg='
const SCENARIO = '#scenario='

/** The hash for a scenario, or for an open message in it (includes the leading #). */
export function reportHash(ref: HashRef): string {
  return ref.messageId
    ? `${MESSAGE}${encodeId(ref.scenarioId)}/${encodeId(ref.messageId)}`
    : `${SCENARIO}${encodeId(ref.scenarioId)}`
}

/** encodeURIComponent throws on a lone surrogate; such an id gets U+FFFD in its place. */
function encodeId(id: string): string {
  return encodeURIComponent(
    id.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD'),
  )
}

function decodeId(raw: string): string | null {
  try {
    return decodeURIComponent(raw) || null
  } catch {
    return null
  }
}

/**
 * Read a location hash. The first unencoded / after `#msg=` splits scenario and
 * message. Anything else (an unrelated fragment, a malformed token) gives null.
 */
export function parseReportHash(hash: string): HashRef | null {
  if (!hash) return null
  const raw = hash.startsWith('#') ? hash : `#${hash}`
  if (raw.startsWith(SCENARIO)) {
    const scenarioId = decodeId(raw.slice(SCENARIO.length))
    return scenarioId ? { scenarioId } : null
  }
  if (!raw.startsWith(MESSAGE)) return null
  const rest = raw.slice(MESSAGE.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  const scenarioId = decodeId(rest.slice(0, slash))
  const messageId = decodeId(rest.slice(slash + 1))
  return scenarioId && messageId ? { scenarioId, messageId } : null
}

/**
 * Write the hash without a new history entry when replace is available (selecting
 * scenarios should not fill Back). Falls back to assigning location.hash on file
 * pages that reject replaceState. Null clears it.
 */
export function writeReportHash(
  locationLike: { hash: string; replace?: (url: string) => void },
  ref: HashRef | null,
): void {
  const next = ref ? reportHash(ref) : ''
  const current = locationLike.hash || ''
  const normalised = current.startsWith('#') || current === '' ? current : `#${current}`
  if (next === (normalised === '#' ? '' : normalised)) return
  if (typeof locationLike.replace === 'function') {
    try {
      locationLike.replace(next || '#')
      return
    } catch {
      /* file:// may throw; fall through */
    }
  }
  locationLike.hash = next
}
