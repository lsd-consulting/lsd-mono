// The version of this report page (lsd-mono-report-html), stamped into the bundle when it is built.
// The page is the same whatever wrote the data, so the version it shows and pings with is its own,
// not the report's `generator`, which says what wrote the data.

import type { Generator } from '../types'

declare const __LSD_VIEWER_VERSION__: string

/** The Gradle build sets LSD_VIEWER_VERSION to the project version; anything else builds `dev`. */
export const VIEWER_VERSION: string = __LSD_VIEWER_VERSION__

/**
 * What wrote the data, for "Written by …": `lsd-mono-jvm 0.15.0` shows as `lsd-mono-jvm` when the
 * page is that version too (the chip already says it), and in full when the versions differ. A
 * `dev` page shows it in full, as it has no release version to compare with. A generator with no
 * version shows as it is.
 */
export function writtenBy(generator: Generator, version: string = VIEWER_VERSION): string {
  return generator.version && generator.version !== version ? `${generator.name} ${generator.version}` : generator.name
}
