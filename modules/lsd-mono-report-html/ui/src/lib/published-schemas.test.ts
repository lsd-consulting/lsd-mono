// The released schemas kept in modules/lsd-mono-report-schema/published/<version>/: each is frozen
// once released, and a newer schema only adds to it (the compatibility rule in the schema README).
// The Pages workflow publishes every one at its $id, so an old report's schema URL keeps resolving.
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixtureData, fixtures } from './conformance.test-util'
import { SCHEMA_DIR } from './report-schema.test-util'

const FILES = ['lsd-report.schema.json', 'lsd-index.schema.json']
const PUBLISHED = join(SCHEMA_DIR, 'published')

type Json = Record<string, unknown>

/** The version in a schema's `$id`, such as `1.0.0`. */
const versionOf = (schema: { $id: string }) => /\/schema\/([^/]+)\//.exec(schema.$id)![1]

const semver = (v: string) => v.split('.').map(Number)
const byVersion = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)]
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/** The released versions, oldest first. */
const released = readdirSync(PUBLISHED).sort(byVersion)

const liveText = (file: string) => readFileSync(join(SCHEMA_DIR, file), 'utf8')
const publishedText = (version: string, file: string) => readFileSync(join(PUBLISHED, version, file), 'utf8')

/** A validator per schema file, for one set of schema texts (each version needs its own: the $ids clash). */
function validators(text: (file: string) => string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  ajv.addKeyword({ keyword: 'tsType', schemaType: 'string' })
  const schemas = FILES.map((file) => JSON.parse(text(file)) as { $id: string } & Json)
  schemas.forEach((schema) => ajv.addSchema(schema))
  return Object.fromEntries(FILES.map((file, i) => [file, ajv.getSchema(schemas[i].$id)!]))
}

/** Where [after] takes away from [before]: a grown `required` list, a removed property or enum value. */
function narrowings(before: unknown, after: unknown, path = ''): string[] {
  if (!before || typeof before !== 'object' || !after || typeof after !== 'object') return []
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return []
    return before.flatMap((b, i) => narrowings(b, after[i], `${path}/${i}`))
  }
  const [b, a] = [before as Json, after as Json]
  const found: string[] = []
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => JSON.stringify(x)) : [])
  for (const name of list(a.required))
    if (!list(b.required).includes(name)) found.push(`${path}/required: ${name} added`)
  for (const value of list(b.enum)) if (!list(a.enum).includes(value)) found.push(`${path}/enum: ${value} removed`)
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
    for (const file of FILES) {
      const version = versionOf(JSON.parse(liveText(file)) as { $id: string })
      if (!existsSync(join(PUBLISHED, version))) continue
      expect(
        liveText(file) === publishedText(version, file),
        `${file} differs from published/${version}/${file}, which is released and frozen: ` +
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
    for (const version of released.filter(
      (v) => semver(v)[0] === semver(versionOf(JSON.parse(liveText(FILES[0])) as { $id: string }))[0],
    )) {
      const old = validators((file) => publishedText(version, file))
      for (const fixture of checked) {
        const data = fixtureData(fixture)
        if (old[fixture.schema!](data))
          expect(live[fixture.schema!](data), `${fixture.file}, valid under ${version}`).toBe(true)
      }
    }
  })

  it('only add from one minor version to the next', () => {
    const live = Object.fromEntries(FILES.map((f) => [f, JSON.parse(liveText(f)) as unknown]))
    const versions = released.map((v) => ({
      v,
      schemas: Object.fromEntries(FILES.map((f) => [f, JSON.parse(publishedText(v, f)) as unknown])),
    }))
    const chain = [...versions, { v: 'current', schemas: live }]
    for (let i = 1; i < chain.length; i++) {
      const [before, after] = [chain[i - 1], chain[i]]
      if (after.v !== 'current' && semver(after.v)[0] !== semver(before.v)[0]) continue
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
  })
})
