import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { otlpToReport } from './otlp.ts'
import { importSampleOnce, SAMPLE_TRACE } from './sample.ts'
import { FileReportStore } from './store.ts'

describe('the sample trace', () => {
  let dir: string
  let store: FileReportStore
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lsd-studio-'))
    store = new FileReportStore(dir)
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('is a clean OTLP trace through four made-up services', async () => {
    const converted = otlpToReport(await readFile(SAMPLE_TRACE, 'utf8'))
    expect(converted.errors).toEqual([])
    expect(converted.report?.title).toBe('POST /orders (trace 5a3c1e0b)')
    const text = JSON.stringify(converted.report)
    for (const service of ['storefront', 'orders', 'inventory', 'payments']) expect(text).toContain(service)
    expect(text).not.toMatch(/[<>]|onerror|<script/i)
  })

  it('is imported once by --demo, however often it runs', async () => {
    const first = await importSampleOnce(store)
    expect(first.imported).toBe(true)
    expect(first.report).toMatchObject({ title: 'POST /orders (trace 5a3c1e0b)', source: 'otlp' })
    const second = await importSampleOnce(store)
    expect(second.imported).toBe(false)
    expect(second.report?.id).toBe(first.report?.id)
    expect(await store.list()).toHaveLength(1)
  })

  it('is imported again after it was deleted', async () => {
    const first = await importSampleOnce(store)
    await store.delete(first.report?.id ?? '')
    const again = await importSampleOnce(store)
    expect(again.imported).toBe(true)
    expect(await store.list()).toHaveLength(1)
  })
})
