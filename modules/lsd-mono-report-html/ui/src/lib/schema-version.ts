// What the page does with a report or index of another schema version (see the schema README's
// "Versions"): a minor version only adds, so a newer one is shown with a note that some of it may
// be missing; a newer major version may have changed anything, so the page says it cannot show
// it rather than guess, as it does for a version that is not one. A report without a version is
// from before the schema and is shown.
import { REPORT_SCHEMA_VERSION } from '../types'
import { escapeHtml } from './escape'

/** A version the page does not show. */
export type UnreadableFit =
  /** A newer major version. */
  | { kind: 'newer-major'; version: string }
  /** A `schemaVersion` that is not a major.minor.patch version, such as `v2`, `0.1` or a number. */
  | { kind: 'not-a-version'; version: string }

export type SchemaFit =
  /** This version, an older one, a newer patch, or none (from before the schema). */
  | { kind: 'readable' }
  /** A newer minor version: shown, with a notice. */
  | { kind: 'newer-minor'; version: string }
  /** Not shown. */
  | UnreadableFit

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

function parts(version: string): [number, number] | null {
  const match = SEMVER.exec(version)
  return match ? [Number(match[1]), Number(match[2])] : null
}

/** How [version] (a report's or index's `schemaVersion`) fits this page's [ui] version. */
export function schemaFit(version: unknown, ui: string = REPORT_SCHEMA_VERSION): SchemaFit {
  if (version === undefined || version === null) return { kind: 'readable' }
  const text = typeof version === 'string' ? version : JSON.stringify(version)
  const theirs = parts(text)
  const ours = parts(ui)
  if (!theirs) return { kind: 'not-a-version', version: text }
  if (!ours || theirs[0] > ours[0]) return { kind: 'newer-major', version: text }
  if (theirs[0] === ours[0] && theirs[1] > ours[1]) return { kind: 'newer-minor', version: text }
  return { kind: 'readable' }
}

/** Whether [data]'s version is one this page cannot show. Only reads `schemaVersion`. */
export function unreadableFit(data: unknown): UnreadableFit | null {
  const version =
    typeof data === 'object' && data !== null ? (data as { schemaVersion?: unknown }).schemaVersion : undefined
  const fit = schemaFit(version)
  return fit.kind === 'newer-major' || fit.kind === 'not-a-version' ? fit : null
}

/** The small notice above a report of a newer minor version. Empty for any other version. */
export function newerMinorNoticeHtml(version: unknown, what: 'report' | 'index' = 'report'): string {
  const fit = schemaFit(version)
  if (fit.kind !== 'newer-minor') return ''
  return `<p class="schema-notice" role="note">This ${what} was written by a newer lsd-mono (report format ${escapeHtml(fit.version)}; this page reads ${REPORT_SCHEMA_VERSION}). Anything new in it is not shown: upgrade lsd-mono to see all of it.</p>`
}

/**
 * What the page shows instead of a report or index it does not show. A labelled region, not an
 * alert: it is the whole page, there from the start, and not news to announce.
 */
export function upgradeHtml(fit: UnreadableFit, what: 'report' | 'index', heading: 'h1' | 'h2' = 'h1'): string {
  const version = escapeHtml(fit.version)
  if (fit.kind === 'not-a-version') {
    return `<section class="schema-upgrade" aria-labelledby="schema-upgrade-title">
    <${heading} id="schema-upgrade-title">This ${what} cannot be opened</${heading}>
    <p>Its report format, ${version}, is not a version number: this page reads format ${REPORT_SCHEMA_VERSION}, written as major.minor.patch.</p>
    <p>The ${what} may have been written by another tool or edited by hand. Write it again with lsd-mono, or open it with the report page that came with it.</p>
  </section>`
  }
  return `<section class="schema-upgrade" aria-labelledby="schema-upgrade-title">
    <${heading} id="schema-upgrade-title">Upgrade lsd-mono to open this ${what}</${heading}>
    <p>This ${what} uses report format ${version}, which this page cannot read: it reads format ${REPORT_SCHEMA_VERSION}, and a new major version may change anything.</p>
    <p>Upgrade lsd-mono to the version that wrote the ${what}, or newer, and run the tests again; or open the ${what} with the report page that came with it.</p>
  </section>`
}
