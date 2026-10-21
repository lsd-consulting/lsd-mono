/**
 * The report's place in the URL hash, so a link or a reload shows the same thing.
 * Hash only: file:// pages cannot rely on the History API or a server.
 *
 * Forms:
 * - `#scenario=<scenarioId>`: that scenario is shown. `&view=components` after it shows its
 *   Components view (#105); without it, Sequence.
 * - `#msg=<scenarioId>/<messageId>`: that scenario is shown and the message is open
 *   in the side panel.
 * - On the index page, either form follows `#report=<reportId>&`, naming the report
 *   the scenario is in. `#report=<reportId>` alone opens that report at its first scenario.
 *
 * Ids are URI-encoded, so a slash in an id cannot split the token.
 */

export interface HashRef {
  /** The report, on the index page. Absent on a single report's page. */
  reportId?: string
  /** Empty when only the report is named. */
  scenarioId: string
  /** Set when a message is open. */
  messageId?: string
  /** The Components view is shown (#105). Never with a message, which opens in Sequence. */
  view?: 'components'
}

const MESSAGE = '#msg='
const SCENARIO = '#scenario='
const REPORT = '#report='
const COMPONENTS_VIEW = '&view=components'

/** The hash for a scenario, or for an open message in it (includes the leading #). */
export function reportHash(ref: HashRef): string {
  if (ref.reportId !== undefined) {
    const report = `${REPORT}${encodeId(ref.reportId)}`
    return ref.scenarioId
      ? `${report}&${reportHash({ scenarioId: ref.scenarioId, messageId: ref.messageId, view: ref.view }).slice(1)}`
      : report
  }
  if (ref.messageId) return `${MESSAGE}${encodeId(ref.scenarioId)}/${encodeId(ref.messageId)}`
  return `${SCENARIO}${encodeId(ref.scenarioId)}${ref.view === 'components' ? COMPONENTS_VIEW : ''}`
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
  if (raw.startsWith(REPORT)) {
    const amp = raw.indexOf('&')
    const reportId = decodeId(raw.slice(REPORT.length, amp < 0 ? undefined : amp))
    if (!reportId) return null
    if (amp < 0) return { reportId, scenarioId: '' }
    const rest = parseReportHash(`#${raw.slice(amp + 1)}`)
    return rest && rest.reportId === undefined ? { reportId, ...rest } : null
  }
  if (raw.startsWith(SCENARIO)) {
    // Ids are encoded, so a literal & can only start the view.
    const rest = raw.slice(SCENARIO.length)
    const components = rest.endsWith(COMPONENTS_VIEW)
    const scenarioId = decodeId(components ? rest.slice(0, -COMPONENTS_VIEW.length) : rest)
    if (!scenarioId) return null
    return components ? { scenarioId, view: 'components' } : { scenarioId }
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
