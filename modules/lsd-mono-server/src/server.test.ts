import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { WebSocket } from 'ws'
import { parseConfig } from './config.ts'
import { startServer, type LsdServer } from './server.ts'
import { FileReportStore } from './store.ts'

const fixture = (file: string) =>
  readFileSync(new URL(`../../lsd-mono-report-schema/conformance/${file}`, import.meta.url), 'utf8')
const MINIMAL = fixture('reports/minimal.json')

describe('the server', () => {
  let dir: string
  let running: LsdServer
  let base: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lsd-server-'))
    running = await startServer({ ...parseConfig(['--port', '0']), reportsDir: dir }, new FileReportStore(dir))
    base = `http://127.0.0.1:${running.address.port}`
  })
  afterEach(async () => {
    await running.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('binds to localhost by default', () => {
    expect(running.address.address).toBe('127.0.0.1')
  })

  it('answers /health', async () => {
    const response = await fetch(`${base}/health`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })

  it('serves the UI shell with an import option', async () => {
    const response = await fetch(base)
    expect(response.headers.get('content-type')).toBe('text/html')
    expect(await response.text()).toMatch(/id="import-file" type="file"/)
  })

  it('imports, lists, reads and deletes an LSD report', async () => {
    const body = MINIMAL
    const imported = await fetch(`${base}/api/reports/import`, { method: 'POST', body })
    expect(imported.status).toBe(201)
    const entry = (await imported.json()) as { id: string; source: string }
    const { id } = entry
    expect(entry.source).toBe('import')
    expect(await (await fetch(`${base}/api/reports`)).json()).toEqual([entry])
    expect(JSON.parse(await (await fetch(`${base}/api/reports/${id}`)).text())).toEqual(JSON.parse(body))
    expect((await fetch(`${base}/api/reports/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await fetch(`${base}/api/reports/${id}`)).status).toBe(404)
    expect((await fetch(`${base}/api/reports/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await fetch(`${base}/api/reports/not-an-id`, { method: 'DELETE' })).status).toBe(400)
  })

  it('answers 501 for what is not built yet, and 415 or 404 for the rest', async () => {
    const otlp = JSON.stringify({ resourceSpans: [] })
    expect((await fetch(`${base}/api/reports/import`, { method: 'POST', body: otlp })).status).toBe(501)
    expect((await fetch(`${base}/api/reports/import`, { method: 'POST', body: 'x' })).status).toBe(415)
    expect((await fetch(`${base}/api/diff`)).status).toBe(501)
    expect((await fetch(`${base}/nowhere`)).status).toBe(404)
  })

  it('greets a capture socket with the protocol', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${running.address.port}/ws/captures`)
    const hello = await new Promise<string>((resolve, reject) => {
      socket.once('message', (data: Buffer) => resolve(data.toString()))
      socket.once('error', reject)
    })
    socket.send('{}')
    socket.close()
    expect(JSON.parse(hello)).toEqual({ type: 'hello', protocol: 'lsd-captures', version: 0 })
  })

  describe('bulk delete', () => {
    const bulkDelete = (body: unknown) =>
      fetch(`${base}/api/reports/bulk-delete`, { method: 'POST', body: JSON.stringify(body) })
    const importOne = async () =>
      ((await (await fetch(`${base}/api/reports/import`, { method: 'POST', body: MINIMAL })).json()) as { id: string })
        .id

    it('deletes the listed reports and names unknown ids', async () => {
      const [a, b, c] = [await importOne(), await importOne(), await importOne()]
      const response = await bulkDelete({ ids: [a, b, 'nope'] })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ deleted: [a, b], notFound: ['nope'] })
      expect(((await (await fetch(`${base}/api/reports`)).json()) as { id: string }[]).map((r) => r.id)).toEqual([c])
    })

    it('answers 200 when none of the ids exist, so a repeat is harmless', async () => {
      const response = await bulkDelete({ ids: ['nope'] })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ deleted: [], notFound: ['nope'] })
    })

    it.each([[[]], [{ ids: [] }], [{ ids: [1] }], [{ ids: 'x' }], [null], [{ ids: Array(1001).fill('x') }]])(
      'answers 400 for the body %j',
      async (body) => {
        expect((await bulkDelete(body)).status).toBe(400)
      },
    )

    it('answers 400 for a body that is not JSON', async () => {
      expect((await fetch(`${base}/api/reports/bulk-delete`, { method: 'POST', body: '{' })).status).toBe(400)
    })
  })

  describe('import validation', () => {
    const importBody = (body: string) => fetch(`${base}/api/reports/import`, { method: 'POST', body })

    it('stores a valid 1.0 report', async () => {
      const response = await importBody(fixture('reports/example-report.json'))
      expect(response.status).toBe(201)
    })

    it('stores a 0.x report, which the report UI upgrades on read', async () => {
      const response = await importBody(fixture('invalid/legacy-report.json'))
      expect(response.status).toBe(201)
      expect(((await response.json()) as { title: string }).title).toBe('Status mix')
    })

    it('answers 422 with the schema errors for an invalid report', async () => {
      const invalid = { ...(JSON.parse(MINIMAL) as object), status: 'nope', generatedAt: 'soon' }
      const response = await importBody(JSON.stringify(invalid))
      expect(response.status).toBe(422)
      const body = (await response.json()) as { error: string; errors: string[] }
      expect(body.error).toBe('Not a valid LSD report')
      expect(body.errors.length).toBeGreaterThan(0)
      expect(body.errors).toEqual(
        expect.arrayContaining([
          '/status: must be equal to one of the allowed values',
          '/generatedAt: must match format "date-time"',
        ]),
      )
      expect(await (await fetch(`${base}/api/reports`)).json()).toEqual([])
    })

    it('answers 413 for a body over the limit', async () => {
      const small = await startServer({ ...parseConfig(['--port', '0']), reportsDir: dir }, new FileReportStore(dir), {
        maxBodyBytes: 100,
      })
      try {
        const url = `http://127.0.0.1:${small.address.port}/api/reports/import`
        expect((await fetch(url, { method: 'POST', body: MINIMAL.padEnd(200) })).status).toBe(413)
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(MINIMAL.padEnd(200)))
            controller.close()
          },
        })
        const chunked = await fetch(url, { method: 'POST', body: stream, duplex: 'half' })
        expect(chunked.status).toBe(413)
      } finally {
        await small.close()
      }
    })
  })
})
