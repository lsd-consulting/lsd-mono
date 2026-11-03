// The released schemas kept in modules/lsd-mono-report-schema/published/<version>/: each is frozen
// once released, and a newer schema only adds to it (the compatibility rule in the schema README).
// The Pages workflow publishes every one at its $id, so an old report's schema URL keeps resolving.
//
// The main guard is the corpus check: every shared test report an earlier schema of the same
// major version accepts must still be accepted. The structural check (narrowings) is a backstop
// for what the corpus may not reach, and is deliberately shallow.
//
// Only versions of the same major version are compared: a new major may break anything, so a
// pair that crosses one (1.x to 2.0.0) is skipped, whatever order its folders were added in.
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixtureData, fixtures } from './conformance.test-util'
import { SCHEMA_DIR } from './report-schema.test-util'

const FILES = ['lsd-report.schema.json', 'lsd-index.schema.json']
const PUBLISHED = join(SCHEMA_DIR, 'published')
const RELEASE = /^\d+\.\d+\.\d+$/

type Json = Record<string, unknown>

/** The version in a schema's `$id`, such as `1.0.0`. */
const versionOf = (schema: { $id: string }) => /\/schema\/([^/]+)\//.exec(schema.$id)![1]

const semver = (v: string) => v.split('.').map(Number)
const major = (v: string) => semver(v)[0]
const byVersion = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/** The released versions, oldest first: the folders named x.y.z (anything else there is ignored). */
const released = readdirSync(PUBLISHED)
  .filter((name) => RELEASE.test(name))
  .sort(byVersion)

const liveText = (file: string) => readFileSync(join(SCHEMA_DIR, file), 'utf8')
const publishedText = (version: string, file: string) => readFileSync(join(PUBLISHED, version, file), 'utf8')
const liveVersion = versionOf(JSON.parse(liveText(FILES[0])) as { $id: string })

/** A validator per schema file, for one set of schema texts (each version needs its own: the $ids clash). */
function validators(text: (file: string) => string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addKeyword({ keyword: 'tsType', schemaType: 'string' })
  const schemas = FILES.map((file) => JSON.parse(text(file)) as { $id: string } & Json)
  schemas.forEach((schema) => ajv.addSchema(schema))
  return Object.fromEntries(FILES.map((file, i) => [file, ajv.getSchema(schemas[i].$id)!]))
}

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
const list = (v: unknown) =>
  Array.isArray(v) ? v.map((x) => JSON.stringify(x)) : v === undefined ? [] : [JSON.stringify(v)]

/**
 * Where [after] takes away from [before]: a grown `required` list; a removed property, `$defs`
 * entry, enum value, `type` or `anyOf`/`oneOf` branch (compared as sets); and a new `const`, enum
 * or `additionalProperties`, or one made `false`. Recurses into objects only, by key.
 */
function narrowings(before: unknown, after: unknown, path = ''): string[] {
  if (!isObject(before) || !isObject(after)) return []
  const [b, a] = [before, after]
  const found: string[] = []
  for (const name of list(a.required))
    if (!list(b.required).includes(name)) found.push(`${path}/required: ${name} added`)
  for (const key of ['enum', 'type', 'anyOf', 'oneOf'])
    if (key in b)
      for (const value of list(b[key]))
        if (!list(a[key]).includes(value)) found.push(`${path}/${key}: ${value} removed`)
  for (const key of ['const', 'enum', 'additionalProperties'])
    if (key in a && !(key in b)) found.push(`${path}/${key} added`)
  if (a.additionalProperties === false && b.additionalProperties !== false)
    found.push(`${path}/additionalProperties made false`)
  for (const key of ['properties', '$defs']) {
    const [bp, ap] = [(b[key] ?? {}) as Json, (a[key] ?? {}) as Json]
    for (const name of Object.keys(bp)) if (!(name in ap)) found.push(`${path}/${key}/${name} removed`)
  }
  for (const key of Object.keys(b)) if (key in a) found.push(...narrowings(b[key], a[key], `${path}/${key}`))
  return found
}

describe('the released schemas', () => {
  it('include the current version, unchanged since its release', () => {
    expect(released).toContain('1.0.0')
    expect(
      released,
      `published/${liveVersion}/ is missing (the newest is published/${released.at(-1)}/): ` +
        `copy both schemas from modules/lsd-mono-report-schema/ into published/${liveVersion}/ as you raise the version`,
    ).toContain(liveVersion)
    for (const file of FILES) {
      expect(existsSync(join(PUBLISHED, liveVersion, file)), `published/${liveVersion}/${file} exists`).toBe(true)
      expect(
        liveText(file) === publishedText(liveVersion, file),
        `${file} differs from published/${liveVersion}/${file}, which is released and frozen: ` +
          `raise the minor version (both $ids and ReportSchema.VERSION), and copy the new schemas to published/<new version>/`,
      ).toBe(true)
    }
  })

  it('each has the $id of its folder', () => {
    for (const version of released)
      for (const file of FILES)
        expect((JSON.parse(publishedText(version, file)) as { $id: string }).$id).toBe(
          `https://lsd-consulting.github.io/lsd-mono/schema/${version}/${file}`,
        )
  })

  it('accept nothing the current schema rejects: every corpus file valid under one is valid now', () => {
    const live = validators(liveText)
    const checked = fixtures.filter((f) => f.schema && FILES.includes(f.schema))
    expect(checked.length).toBeGreaterThan(10)
    for (const version of released.filter((v) => major(v) === major(liveVersion))) {
      const old = validators((file) => publishedText(version, file))
      for (const fixture of checked) {
        const data = fixtureData(fixture)
        if (old[fixture.schema!](data))
          expect(live[fixture.schema!](data), `${fixture.file}, valid under ${version}`).toBe(true)
      }
    }
  })

  it('only add from one minor version to the next', () => {
    const parsed = (text: (file: string) => string) =>
      Object.fromEntries(FILES.map((f) => [f, JSON.parse(text(f)) as unknown]))
    const chain = [
      ...released.map((v) => ({ v, schemas: parsed((f) => publishedText(v, f)) })),
      { v: liveVersion, schemas: parsed(liveText) },
    ]
    for (let i = 1; i < chain.length; i++) {
      const [before, after] = [chain[i - 1], chain[i]]
      if (major(after.v) !== major(before.v)) continue
      for (const file of FILES)
        expect(narrowings(before.schemas[file], after.schemas[file]), `${file}: ${before.v} to ${after.v}`).toEqual([])
    }
  })

  it('catch a narrowing', () => {
    const before = { required: ['a'], properties: { a: {}, b: { enum: ['x', 'y'] } } }
    const after = { required: ['a', 'b'], properties: { a: {}, b: { enum: ['x'] } } }
    expect(narrowings(before, after)).toEqual(['/required: "b" added', '/properties/b/enum: "y" removed'])
    expect(narrowings(after, { required: ['a', 'b'], properties: { b: { enum: ['x', 'z'] } } })).toEqual([
      '/properties/a removed',
    ])
    const open = { type: ['string', 'null'], anyOf: [{ type: 'string' }, { type: 'number' }], properties: { c: {} } }
    expect(
      narrowings(open, {
        type: 'string',
        anyOf: [{ type: 'number' }],
        additionalProperties: false,
        properties: { c: { const: 1, enum: [1] } },
      }),
    ).toEqual([
      '/type: "null" removed',
      '/anyOf: {"type":"string"} removed',
      '/additionalProperties added',
      '/additionalProperties made false',
      '/properties/c/const added',
      '/properties/c/enum added',
    ])
    expect(narrowings({ anyOf: [{ a: 1 }, { b: 2 }] }, { anyOf: [{ b: 2 }, { a: 1 }, { c: 3 }] })).toEqual([])
  })
})
