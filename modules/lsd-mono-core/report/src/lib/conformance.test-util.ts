// The shared test reports in modules/lsd-mono-report-schema/conformance, which lsd-mono-core's
// tests write and check too. For the unit tests and the Playwright checks (Node, not the page).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Report } from '../types'

// A path, not a URL: under happy-dom the global URL is not Node's, and fs refuses it.
/** The corpus directory. */
export const CONFORMANCE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../lsd-mono-report-schema/conformance',
)

/** A corpus file's text, by its path in the corpus (`reports/timing-tree.json`). */
export function conformanceText(file: string): string {
  return readFileSync(join(CONFORMANCE, file), 'utf8')
}

/** A report from the corpus's `reports/`, by name (`timing-tree`). */
export function conformanceReport(name: string): Report {
  return JSON.parse(conformanceText(`reports/${name}.json`)) as Report
}
