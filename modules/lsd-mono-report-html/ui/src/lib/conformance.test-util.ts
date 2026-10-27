// The shared test reports in modules/lsd-mono-report-schema/conformance, which lsd-mono-jvm's
// tests write and check too. For the unit tests and the Playwright checks (Node, not the page).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { largeReport as generateLarge } from '../../../../lsd-mono-report-schema/conformance/generated/large.mjs'
import type { Report } from '../types'

// A path, not a URL: under happy-dom the global URL is not Node's, and fs refuses it.
/** The corpus directory. */
export const CONFORMANCE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../lsd-mono-report-schema/conformance',
)

/** One entry of the corpus's manifest.json. */
export interface Fixture {
  file: string
  /** The schema file it is checked against; absent for the payload script. */
  schema?: string
  /** Whether the schema must accept it. */
  valid?: boolean
  /** For an invalid file: the JSON Pointer of one place the schema rejects. */
  rejectedAt?: string
  source: 'lsd-mono-jvm' | 'captured' | 'hand-written' | 'generated'
  /**
   * What the page shows for a report it boots though the schema rejects it or it is not one to
   * show: the report, the upgrade page or the cannot-open page. Absent: a valid report is shown.
   */
  page?: 'report' | 'upgrade' | 'cannot-open'
  about: string
}

/** A corpus file's text, by its path in the corpus (`reports/timing-tree.json`). */
export function conformanceText(file: string): string {
  return readFileSync(join(CONFORMANCE, file), 'utf8')
}

/** A report from the corpus's `reports/`, by name (`timing-tree`). */
export function conformanceReport(name: string): Report {
  return JSON.parse(conformanceText(`reports/${name}.json`)) as Report
}

/** Every file the manifest lists. */
export const fixtures: Fixture[] = (JSON.parse(conformanceText('manifest.json')) as { fixtures: Fixture[] }).fixtures

/** A fixture's data: the parsed JSON, or the generated report for `generated/large.mjs`. */
export function fixtureData(fixture: Fixture): unknown {
  return fixture.file === 'generated/large.mjs' ? largeReport() : JSON.parse(conformanceText(fixture.file))
}

/** The generated large report (100 participants, 400 messages unless asked for another size). */
export function largeReport(size?: { participants?: number; messages?: number }): Report {
  return generateLarge(size) as unknown as Report
}
