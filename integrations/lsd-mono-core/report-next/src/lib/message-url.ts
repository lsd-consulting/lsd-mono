/**
 * Deep-link to an open message on a static report page.
 * Hash only — file:// pages cannot rely on the History API or a server.
 *
 * Form: #msg=<scenarioId>/<messageId>
 * Both ids are URI-encoded so slashes in an id cannot split the token.
 */

export interface MessageRef {
  scenarioId: string
  messageId: string
}

const PREFIX = '#msg='

/** Build the hash fragment for an open message (includes the leading #). */
export function messageHash(scenarioId: string, messageId: string): string {
  return `${PREFIX}${encodeURIComponent(scenarioId)}/${encodeURIComponent(messageId)}`
}

/**
 * Parse a location hash. Accepts #msg=a/b, #msg=a%2Fb is not used for the
 * separator — the first unencoded / after the prefix splits scenario and message.
 */
export function parseMessageHash(hash: string): MessageRef | null {
  if (!hash) return null
  const raw = hash.startsWith('#') ? hash : `#${hash}`
  if (!raw.startsWith(PREFIX)) return null
  const rest = raw.slice(PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return null
  try {
    const scenarioId = decodeURIComponent(rest.slice(0, slash))
    const messageId = decodeURIComponent(rest.slice(slash + 1))
    if (!scenarioId || !messageId) return null
    return { scenarioId, messageId }
  } catch {
    return null
  }
}

/** True when this hash points at a message (used to decide clear vs leave alone). */
export function isMessageHash(hash: string): boolean {
  return parseMessageHash(hash) != null
}

/**
 * Write the open-message hash without pushing a history entry when replace is available.
 * Falls back to assigning location.hash on file pages that reject replaceState.
 */
export function writeMessageHash(
  locationLike: { hash: string; replace?: (url: string) => void },
  ref: MessageRef | null,
): void {
  const next = ref ? messageHash(ref.scenarioId, ref.messageId) : ''
  const current = locationLike.hash || ''
  const normalised = current.startsWith('#') || current === '' ? current : `#${current}`
  if ((next || '') === (normalised === '#' ? '' : normalised)) return
  if (typeof locationLike.replace === 'function') {
    try {
      locationLike.replace(next || '#')
      return
    } catch {
      /* file:// may throw; fall through */
    }
  }
  locationLike.hash = next || ''
}

/** Clear only a message hash; leave unrelated fragments alone. */
export function clearMessageHash(locationLike: { hash: string; replace?: (url: string) => void }): void {
  if (!isMessageHash(locationLike.hash)) return
  writeMessageHash(locationLike, null)
}
