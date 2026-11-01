import { existsSync, readFileSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import ajvFormats from 'ajv-formats'
import { otlpToReport } from './otlp.ts'
import type { ReportStore, StoredReport } from './store.ts'

/** What an imported file is. Both kinds land as stored reports (#186). */
export type ImportKind = 'lsd-report' | 'otlp' | 'unknown'

/**
 * Tells an LSD report from an OTLP JSON export by its top-level keys. A report from before schema
 * 1.0.0 may have no `schemaVersion`; one with a `scenarios` list still counts, as the report UI
 * opens it. OTLP protobuf is not JSON, so it is 'unknown'.
 */
export function detectImport(body: string): ImportKind {
  const json = parseObject(body)
  if (json === undefined) return 'unknown'
  if ('resourceSpans' in json) return 'otlp'
  if ('schemaVersion' in json || Array.isArray(json.scenarios)) return 'lsd-report'
  return 'unknown'
}

/** The copy of the report schema that `npm install` makes (scripts/copy-schema.mjs) and the package ships. */
export const BUNDLED_SCHEMA = new URL('../schema/lsd-report.schema.json', import.meta.url)
/**
 * The repo's report schema (modules/lsd-mono-report-schema), the same file the writer and the report
 * UI are tested against.
 */
export const REPO_SCHEMA = new URL('../../lsd-mono-report-schema/lsd-report.schema.json', import.meta.url)

/** The first schema that exists: the bundled copy, then the repo's. */
export function findSchema(candidates: readonly URL[] = [BUNDLED_SCHEMA, REPO_SCHEMA]): URL {
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) throw new Error(`No report schema at ${candidates.map((c) => c.pathname).join(' or ')}`)
  return found
}
const REPORT_SCHEMA = findSchema()

const ajv = new Ajv2020({ allErrors: true, strict: true })
// ajv-formats is CommonJS: under NodeNext its types put the plugin on `.default`, but Node's ESM
// import of it is module.exports, which is the plugin itself.
const addFormats = ajvFormats as unknown as typeof ajvFormats.default
addFormats(ajv)
// json-schema-to-typescript's keyword in the schema (the UI's generated types); not a check.
ajv.addKeyword({ keyword: 'tsType', schemaType: 'string' })
const validateSchema = ajv.compile(JSON.parse(readFileSync(REPORT_SCHEMA, 'utf8')) as object)

/** At most this many errors are reported, so a hostile file can't make a huge response. */
export const MAX_ERRORS = 50

/**
 * Why [body] is not an LSD report the report UI can open, as `path: message` lines; empty when it
 * is one. Mirrors the report UI (isLegacy in report-normalise.ts):
 * - **1.x** reports are checked against the 1.0.0 schema, which accepts newer minors by design.
 * - **0.x** reports (major 0, or no `schemaVersion`) predate the schema. 1.0.0 rejects their shape,
 *   but the UI upgrades them on read, so only the basics the upgrade needs are checked.
 * - **2.0.0 and later** are refused: the UI would only say to upgrade lsd-mono.
 */
export function reportErrors(body: string): string[] {
  const json = parseObject(body)
  if (json === undefined) return ['/: must be a JSON object']
  const version = json.schemaVersion
  if (version === undefined || version === null || (typeof version === 'string' && version.startsWith('0.'))) {
    return legacyErrors(json)
  }
  const major = typeof version === 'string' ? Number(version.split('.')[0]) : NaN
  if (major > 1) return [`/schemaVersion: ${version as string} is a newer major than this server reads (1.x)`]
  if (validateSchema(json)) return []
  return (validateSchema.errors ?? []).slice(0, MAX_ERRORS).map((e) => `${e.instancePath || '/'}: ${e.message}`)
}

function legacyErrors(json: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (json.title !== undefined && typeof json.title !== 'string') errors.push('/title: must be string')
  if (json.scenarios !== undefined) {
    if (!Array.isArray(json.scenarios)) errors.push('/scenarios: must be array')
    else
      json.scenarios.forEach((scenario: unknown, i) => {
        if (typeof scenario !== 'object' || scenario === null || Array.isArray(scenario)) {
          errors.push(`/scenarios/${i}: must be object`)
        }
      })
  }
  return errors.slice(0, MAX_ERRORS)
}

function parseObject(body: string): Record<string, unknown> | undefined {
  try {
    const json: unknown = JSON.parse(body)
    return typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** What an import answers: its status, and the stored report or the reason it was refused. */
export interface ImportResult {
  status: 201 | 415 | 422 | 500
  report?: StoredReport
  error?: string
  errors?: string[]
}

/**
 * Imports an uploaded body: an LSD report is checked and stored, an OTLP/JSON export is converted,
 * checked and stored. `POST /api/reports/import` and `--demo` both come through here.
 */
export async function importBody(body: string, store: ReportStore): Promise<ImportResult> {
  switch (detectImport(body)) {
    case 'lsd-report': {
      const errors = reportErrors(body)
      if (errors.length > 0) return { status: 422, error: 'Not a valid LSD report', errors }
      return { status: 201, report: await store.save(body, 'import') }
    }
    case 'otlp': {
      const converted = otlpToReport(body)
      if (converted.report === undefined) {
        return { status: 422, error: 'Not a valid OTLP/JSON trace export', errors: converted.errors }
      }
      const json = JSON.stringify(converted.report)
      // The converted report goes through the same check as an imported one.
      const errors = reportErrors(json)
      if (errors.length > 0) return { status: 500, error: 'The converted report is not valid', errors }
      return { status: 201, report: await store.save(json, 'otlp') }
    }
    default:
      return { status: 415, error: 'Not an LSD report or OTLP JSON (OTLP protobuf is not supported)' }
  }
}
