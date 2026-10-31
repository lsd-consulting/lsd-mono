import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileReportStore } from './store.ts'

describe('FileReportStore', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lsd-server-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('lists nothing before the directory exists', async () => {
    expect(await new FileReportStore(join(dir, 'missing')).list()).toEqual([])
  })

  it('saves, lists, reads and deletes a report', async () => {
    const store = new FileReportStore(join(dir, 'reports'))
    const id = await store.save('{"schemaVersion":"1.0.0"}')
    expect(await store.list()).toEqual([{ id }])
    expect(await store.get(id)).toBe('{"schemaVersion":"1.0.0"}')
    expect(await store.delete(id)).toBe(true)
    expect(await store.delete(id)).toBe(false)
    expect(await store.get(id)).toBeUndefined()
  })

  it('bulk deletes the reports that exist', async () => {
    const store = new FileReportStore(dir)
    const ids = [await store.save('{}'), await store.save('{}'), await store.save('{}')]
    expect(await store.deleteAll([ids[0], ids[1], 'not-an-id'])).toBe(2)
    expect(await store.list()).toEqual([{ id: ids[2] }])
  })

  it('never reads outside its directory', async () => {
    expect(await new FileReportStore(dir).get('../secret')).toBeUndefined()
  })
})
