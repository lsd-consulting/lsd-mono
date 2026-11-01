import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileReportStore } from './store.ts'

describe('FileReportStore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lsd-studio-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('lists nothing before the directory exists', async () => {
    expect(await new FileReportStore(join(dir, 'missing')).list()).toEqual([])
  })

  it('saves, lists, reads and deletes a report', async () => {
    const store = new FileReportStore(join(dir, 'reports'))
    const json = '{"schemaVersion":"1.0.0","title":" Checkout "}'
    const entry = await store.save(json)
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.importedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(entry).toMatchObject({ title: 'Checkout', source: 'import', size: json.length })
    expect(await store.list()).toEqual([entry])
    expect(await store.get(entry.id)).toBe(json)
    expect(await store.delete(entry.id)).toBe(true)
    expect(await store.delete(entry.id)).toBe(false)
    expect(await store.get(entry.id)).toBeUndefined()
    expect(await store.list()).toEqual([])
  })

  it('keeps the index on disk, so a new store sees the same list', async () => {
    const first = new FileReportStore(dir)
    const entry = await first.save('{"title":"Kept"}', 'capture')
    expect(await new FileReportStore(dir).list()).toEqual([entry])
    expect(JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'))).toEqual([entry])
  })

  it('replaces a stored report in place, keeping its id, source and import time', async () => {
    const store = new FileReportStore(dir)
    const live = await store.save('{"title":"Live"}', 'capture')
    const other = await store.save('{"title":"Other"}')
    const json = '{"title":"Live, grown"}'
    const replaced = await store.replace(live.id, json)
    expect(replaced).toEqual({ ...live, title: 'Live, grown', size: json.length })
    expect(await store.get(live.id)).toBe(json)
    expect(await store.list()).toEqual(expect.arrayContaining([other, replaced]))
    expect(await store.list()).toHaveLength(2)
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(await store.replace('0f8fad5b-d9cb-469f-a165-70867728950e', json)).toBeUndefined()
  })

  it('falls back to "Untitled report" without a usable title', async () => {
    const store = new FileReportStore(dir)
    expect((await store.save('{}')).title).toBe('Untitled report')
    expect((await store.save('{"title":3}')).title).toBe('Untitled report')
    expect((await store.save('not json')).title).toBe('Untitled report')
  })

  it('lists newest first', async () => {
    const store = new FileReportStore(dir)
    const older = await store.save('{"title":"a"}')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const newer = await store.save('{"title":"b"}')
    expect((await store.list()).map((entry) => entry.id)).toEqual([newer.id, older.id])
  })

  it('bulk deletes the reports that exist and names the ones that do not', async () => {
    const store = new FileReportStore(dir)
    const ids = [(await store.save('{}')).id, (await store.save('{}')).id, (await store.save('{}')).id]
    expect(await store.deleteAll([ids[0], ids[1], ids[1], 'not-an-id'])).toEqual({
      deleted: [ids[0], ids[1]],
      notFound: ['not-an-id'],
    })
    expect((await store.list()).map((entry) => entry.id)).toEqual([ids[2]])
    expect((await readdir(dir)).sort()).toEqual([`${ids[2]}.json`, 'index.json'].sort())
  })

  it('keeps every entry when saves run at once', async () => {
    const store = new FileReportStore(dir)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(`{"title":"r${i}"}`)))
    expect(await new FileReportStore(dir).list()).toHaveLength(20)
  })

  it('rebuilds the index from report files written before it existed', async () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    await writeFile(join(dir, `${id}.json`), '{"title":"Old"}')
    await writeFile(join(dir, 'notes.json'), '{}')
    const store = new FileReportStore(dir)
    const [entry] = await store.list()
    expect(entry).toMatchObject({ id, title: 'Old', source: 'import', size: 15 })
    expect(await store.delete(id)).toBe(true)
    expect(await store.list()).toEqual([])
  })

  it('keeps the otlp source of a converted export when it rebuilds the index', async () => {
    const id = '1f8fad5b-d9cb-469f-a165-70867728950e'
    await writeFile(join(dir, `${id}.json`), '{"title":"Trace","generator":{"name":"lsd-mono-server OTLP import"}}')
    await writeFile(join(dir, '2f8fad5b-d9cb-469f-a165-70867728950e.json'), 'not json')
    await writeFile(
      join(dir, '3f8fad5b-d9cb-469f-a165-70867728950e.json'),
      '{"title":"Trace","generator":{"name":"LSD Studio (OTLP import)"}}',
    )
    const sources = (await new FileReportStore(dir).list()).map((entry) => entry.source)
    expect(sources.sort()).toEqual(['import', 'otlp', 'otlp'])
  })

  it('never reads outside its directory', async () => {
    expect(await new FileReportStore(dir).get('../secret')).toBeUndefined()
  })
})
