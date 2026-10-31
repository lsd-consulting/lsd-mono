import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { parseConfig } from './config.ts'
import { startServer, type LsdServer } from './server.ts'
import { FileReportStore } from './store.ts'

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
    const body = JSON.stringify({ schemaVersion: '1.0.0', scenarios: [] })
    const imported = await fetch(`${base}/api/reports/import`, { method: 'POST', body })
    expect(imported.status).toBe(201)
    const { id } = (await imported.json()) as { id: string }
    expect(await (await fetch(`${base}/api/reports`)).json()).toEqual([{ id }])
    expect(JSON.parse(await (await fetch(`${base}/api/reports/${id}`)).text())).toEqual(JSON.parse(body))
    expect((await fetch(`${base}/api/reports/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await fetch(`${base}/api/reports/${id}`)).status).toBe(404)
    expect((await fetch(`${base}/api/reports/${id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('answers 501 for what is not built yet, and 415 or 404 for the rest', async () => {
    const otlp = JSON.stringify({ resourceSpans: [] })
    expect((await fetch(`${base}/api/reports/import`, { method: 'POST', body: otlp })).status).toBe(501)
    expect((await fetch(`${base}/api/reports/import`, { method: 'POST', body: 'x' })).status).toBe(415)
    expect((await fetch(`${base}/api/reports/bulk-delete`, { method: 'POST', body: '[]' })).status).toBe(501)
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
})
