// The report's TypeScript types, generated from the JSON Schemas in modules/lsd-mono-report-schema
// into src/generated/. `npm run types:generate` writes them; `npm run types:check` (on Gradle's
// check path, through reportLint) fails when the committed files differ, so they are never
// edited by hand: change the schema and generate again.
import { compile } from 'json-schema-to-typescript'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const schemaDir = fileURLToPath(new URL('../../../lsd-mono-report-schema/', import.meta.url))
const outDir = new URL('../src/generated/', import.meta.url)

/**
 * [schema] is generated into [out]. The index's file declares its own copy of the report's Status
 * (it is a $ref across the files): the same union, so either one can be used.
 */
const FILES = [
  { schema: 'lsd-report.schema.json', out: 'lsd-report.ts', version: true },
  { schema: 'lsd-index.schema.json', out: 'lsd-index.ts', version: false },
]

// Objects accept unlisted properties when validated (a newer minor version may add some); the
// types leave them out, so a misspelt field is still a type error. A schema's `tsType` names the
// TypeScript type outright: an open enum is its known values or any other string.
const OPTIONS = {
  additionalProperties: false,
  bannerComment: '',
  cwd: schemaDir,
  format: false,
  strictIndexSignatures: true,
  unreachableDefinitions: true,
}

/** The schema version, from the `$id` (`…/schema/<version>/<file>`). */
function versionOf(schema, file) {
  const version = /\/schema\/([^/]+)\//.exec(schema.$id ?? '')?.[1]
  if (!version) throw new Error(`${file}: $id does not name a version`)
  return version
}

async function generate({ schema: file, out, version }) {
  const schema = JSON.parse(readFileSync(schemaDir + file, 'utf8'))
  const types = await compile(schema, schema.title, OPTIONS)
  const banner = [
    `// Generated from modules/lsd-mono-report-schema/${file} by scripts/report-types.mjs.`,
    '// Do not edit: change the schema, then run `npm run types:generate`.',
  ]
  const constant = version
    ? [
        `/** The schema version this UI's types follow, as reports write it in \`schemaVersion\`. */`,
        `export const REPORT_SCHEMA_VERSION = '${versionOf(schema, file)}'`,
        '',
      ]
    : []
  const text = [...banner, '', ...constant, types].join('\n')
  const path = fileURLToPath(new URL(out, outDir))
  return { path, text: await format(text, { ...(await resolveConfig(path)), filepath: path }) }
}

const check = process.argv.includes('--check')
const stale = []
for (const file of FILES) {
  const { path, text } = await generate(file)
  if (!check) writeFileSync(path, text)
  else if (readFileSync(path, 'utf8') !== text) stale.push(path)
}
if (stale.length > 0) {
  console.error(`Generated report types differ from the schema:\n${stale.map((p) => `  ${p}`).join('\n')}`)
  console.error('Do not edit them by hand: change the schema, run `npm run types:generate` and commit the result.')
  process.exit(1)
}
