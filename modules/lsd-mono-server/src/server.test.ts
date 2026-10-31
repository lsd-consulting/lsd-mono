import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
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

  it('converts an OTLP/JSON export on import and stores it as an otlp report', async () => {
    const body = readFileSync(new URL('../fixtures/otlp/checkout-two-services.json', import.meta.url), 'utf8')
    const imported = await fetch(`${base}/api/reports/import`, { method: 'POST', body })
    expect(imported.status).toBe(201)
    const entry = (await imported.json()) as { id: string; title: string; source: string }
    expect(entry).toMatchObject({ title: 'POST /checkout (trace 4bf92f35)', source: 'otlp' })
    const stored = JSON.parse(await (await fetch(`${base}/api/reports/${entry.id}`)).text()) as { scenarios: unknown[] }
    expect(stored.scenarios).toHaveLength(1)
  })

  it('answers 422 with errors for a malformed OTLP export', async () => {
    const response = await fetch(`${base}/api/reports/import`, { method: 'POST', body: '{"resourceSpans":[]}' })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'Not a valid OTLP/JSON trace export',
      errors: ['/resourceSpans: has no spans'],
    })
  })

  it('answers 501 for what is not built yet, and 415 or 404 for the rest', async () => {
    const protobuf = await fetch(`${base}/api/reports/import`, {
      method: 'POST',
      body: new Uint8Array([0x0a, 0x02, 0x08, 0x01]),
    })
    expect(protobuf.status).toBe(415)
    expect(await protobuf.text()).toMatch(/protobuf is not supported/)
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
        const init: RequestInit & { duplex: 'half' } = { method: 'POST', body: stream, duplex: 'half' }
        const chunked = await fetch(url, init)
        expect(chunked.status).toBe(413)
      } finally {
        await small.close()
      }
    })
  })

  describe('report pages', () => {
    const SHELL = '<html><body><div id="app"></div><script>const r=window.__LSD_REPORT__??s</script></body></html>'
    let viewer: LsdServer
    let viewerBase: string
    beforeEach(async () => {
      await writeFile(join(dir, 'shell.html'), SHELL)
      viewer = await startServer({ ...parseConfig(['--port', '0']), reportsDir: dir }, new FileReportStore(dir), {
        viewerShells: [pathToFileURL(join(dir, 'shell.html'))],
      })
      viewerBase = `http://127.0.0.1:${viewer.address.port}`
    })
    afterEach(() => viewer.close())

    const importAt = async (body: string) =>
      ((await (await fetch(`${viewerBase}/api/reports/import`, { method: 'POST', body })).json()) as { id: string }).id

    it('opens a stored report in the report UI shell with a back link', async () => {
      const id = await importAt(MINIMAL)
      const response = await fetch(`${viewerBase}/reports/${id}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
      const page = await response.text()
      const injected = /window\.__LSD_REPORT__=(.*?);<\/script>/.exec(page)![1]
      expect(JSON.parse(injected)).toEqual(JSON.parse(MINIMAL))
      expect(page).toContain('id="lsd-server-back" href="/"')
    })

    it('hands a 0.x report to the shell as stored, for the UI to upgrade', async () => {
      const legacy = fixture('invalid/legacy-report.json')
      const page = await (await fetch(`${viewerBase}/reports/${await importAt(legacy)}`)).text()
      expect(JSON.parse(/window\.__LSD_REPORT__=(.*?);<\/script>/.exec(page)![1])).toEqual(JSON.parse(legacy))
    })

    it('answers unknown and malformed ids with a friendly 404 page', async () => {
      for (const id of ['0f8fad5b-d9cb-469f-a165-70867728950e', 'nope']) {
        const response = await fetch(`${viewerBase}/reports/${id}`)
        expect(response.status).toBe(404)
        expect(await response.text()).toMatch(/Report not found[\s\S]*href="\/"/)
      }
    })

    it('says how to build the viewer when the shell is missing', async () => {
      await rm(join(dir, 'shell.html'))
      const response = await fetch(`${viewerBase}/reports/${await importAt(MINIMAL)}`)
      expect(response.status).toBe(503)
      const page = await response.text()
      expect(page).toContain('cd modules/lsd-mono-server\nnpm run build:viewer')
      expect(page).toContain('prefers-color-scheme: dark')
      expect(page).toContain('installing the server normally builds')
    })

    it('opens reports in the first viewer that is built', async () => {
      const shell = (name: string) => SHELL.replace('<div id="app">', `<div id="${name}">`)
      const [override, bundled, ui] = ['override', 'bundled', 'ui'].map((name) => join(dir, `${name}.html`))
      const id = await importAt(MINIMAL)
      const opened = async (shells: string[]) => {
        const other = await startServer(
          { ...parseConfig(['--port', '0']), reportsDir: dir },
          new FileReportStore(dir),
          {
            viewerShells: shells.map((file) => pathToFileURL(file)),
          },
        )
        try {
          const response = await fetch(`http://127.0.0.1:${other.address.port}/reports/${id}`)
          return response.status === 200 ? /<div id="(\w+)">/.exec(await response.text())![1] : response.status
        } finally {
          await other.close()
        }
      }
      await writeFile(ui, shell('ui'))
      expect(await opened([override, bundled, ui])).toBe('ui')
      await writeFile(bundled, shell('bundled'))
      expect(await opened([override, bundled, ui])).toBe('bundled')
      await writeFile(override, shell('override'))
      expect(await opened([override, bundled, ui])).toBe('override')
      await writeFile(override, '<html>not the viewer</html>')
      expect(await opened([override, bundled, ui])).toBe('bundled')
      expect(await opened([join(dir, 'none.html')])).toBe(503)
    })

    it('uses the viewer given with --viewer', async () => {
      await writeFile(join(dir, 'mine.html'), SHELL.replace('<div id="app">', '<div id="mine">'))
      const config = { ...parseConfig(['--port', '0', '--viewer', join(dir, 'mine.html')]), reportsDir: dir }
      const other = await startServer(config, new FileReportStore(dir))
      try {
        const id = await importAt(MINIMAL)
        expect(await (await fetch(`http://127.0.0.1:${other.address.port}/reports/${id}`)).text()).toContain(
          '<div id="mine">',
        )
      } finally {
        await other.close()
      }
    })
  })
})
