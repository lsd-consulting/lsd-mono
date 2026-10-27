// The version of this report page (lsd-mono-report-html), stamped into the bundle when it is built.
// The page is the same whatever wrote the data, so the version it shows and pings with is its own,
// not the report's `generator`, which says what wrote the data.

declare const __LSD_VIEWER_VERSION__: string

/** The Gradle build sets LSD_VIEWER_VERSION to the project version; anything else builds `dev`. */
export const VIEWER_VERSION: string = __LSD_VIEWER_VERSION__
