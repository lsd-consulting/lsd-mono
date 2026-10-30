// The JSON Schemas in modules/lsd-mono-report-schema, compiled once with ajv for the tests that
// validate reports: formats asserted (ajv-formats), as lsd-mono-jvm's networknt validator does.
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The schema directory, as a path: under happy-dom, `new URL(…, import.meta.url)` is not a file URL. */
export const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../lsd-mono-report-schema/')

/** A schema file, parsed. */
export function schemaFile(file: string): { $id: string } & Record<string, unknown> {
  return JSON.parse(readFileSync(SCHEMA_DIR + file, 'utf8')) as { $id: string } & Record<string, unknown>
}

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
// json-schema-to-typescript's keyword: the TypeScript type for an open enum or the event union.
ajv.addKeyword({ keyword: 'tsType', schemaType: 'string' })
export const reportSchema = schemaFile('lsd-report.schema.json')
export const indexSchema = schemaFile('lsd-index.schema.json')
ajv.addSchema(reportSchema)
ajv.addSchema(indexSchema)
const validators = { report: ajv.getSchema(reportSchema.$id)!, index: ajv.getSchema(indexSchema.$id)! }

/** [data]'s errors against the report or index schema, as `path: message` lines. */
export function schemaErrors(data: unknown, schema: 'report' | 'index' = 'report'): string[] {
  const validate = validators[schema]
  return validate(data) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath}: ${e.message}`)
}

const OMITTED_WHEN_EMPTY = new Set(['description', 'facts', 'metrics', 'from', 'to', 'status', 'warnings'])

/** A UI-shaped fixture as a producer writes it: schema 1.0 never writes an optional field empty. */
export function asWritten<T>(value: T): T {
  if (Array.isArray(value)) return value.map(asWritten) as T
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key, v]) => !(OMITTED_WHEN_EMPTY.has(key) && (v === '' || (Array.isArray(v) && v.length === 0))),
  )
  return Object.fromEntries(entries.map(([key, v]) => [key, asWritten(v)])) as T
}
