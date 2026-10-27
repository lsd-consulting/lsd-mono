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
