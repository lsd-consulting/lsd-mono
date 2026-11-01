import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import type { ServerConfig } from './config.ts'
import { importBody } from './import.ts'
import { CaptureSession, LiveReports } from './live.ts'
import { readSample } from './sample.ts'
import { isReportId, type ReportStore } from './store.ts'
import { checkOverride, findShell, MESSAGES, messagePage, renderReportPage, viewerShells } from './viewer.ts'

const INDEX_HTML = new URL('../public/index.html', import.meta.url)
const CAPTURES_PATH = '/ws/captures'
const HTML = 'text/html; charset=utf-8'
export const MAX_BULK_IDS = 1000
/** The largest request body the server reads, in bytes; a bigger one gets 413. */
export const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024

export interface ServerOptions {
  maxBodyBytes?: number
  /** Where to look for the report UI's single-file shell, in order (viewerShells). */
  viewerShells?: readonly URL[]
}

class BodyTooLarge extends Error {}

export interface LsdServer {
  server: Server
  address: AddressInfo
  close(): Promise<void>
}

/** Starts the server on the config's host and port (port 0 picks a free one). */
export async function startServer(
  config: ServerConfig,
  store: ReportStore,
  options: ServerOptions = {},
): Promise<LsdServer> {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  if (options.viewerShells === undefined) await checkOverride(config.viewer)
  const live = new LiveReports()
  const server = createServer((req, res) => {
    route(req, res, store, live, (r) => readBody(r, limit), options.viewerShells ?? viewerShells(config.viewer)).catch(
      (error: unknown) => {
        if (error instanceof BodyTooLarge) {
          res.setHeader('connection', 'close')
          return send(res, 413, `The body is over the ${limit} byte limit`)
        }
        send(res, 500, String(error))
      },
    )
  })
  attachCaptures(server, store, live)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, resolve)
  })
  return {
    server,
    address: server.address() as AddressInfo,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

// The API the CLI calls. TODO(#186): settle the endpoint set and its versioning.
async function route(
  req: IncomingMessage,
  res: ServerResponse,
  store: ReportStore,
  live: LiveReports,
  readRequest: (req: IncomingMessage) => Promise<string>,
  shells: readonly URL[],
): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  const method = req.method ?? 'GET'
  const report = /^\/api\/reports\/([^/]+)$/.exec(path)

  if (method === 'GET' && path === '/health') return send(res, 200, 'ok')
  if (method === 'GET' && path === '/') return send(res, 200, await readFile(INDEX_HTML, 'utf8'), 'text/html')
  const page = /^\/reports\/([^/]+)$/.exec(path)
  if (method === 'GET' && page) {
    const json = isReportId(page[1]) ? await store.get(page[1]) : undefined
    if (json === undefined) return send(res, 404, messagePage(MESSAGES.notFound), HTML)
    const shell = await findShell(shells)
    if (shell === undefined) return send(res, 503, messagePage(MESSAGES.noShell), HTML)
    const capture = live.get(page[1])
    const watch = capture?.live ? { id: page[1], revision: capture.revision } : undefined
    return send(res, 200, renderReportPage(shell, json, watch), HTML)
  }
  // An open live report polls this to know when to reload (renderReportPage).
  const watched = /^\/api\/reports\/([^/]+)\/live$/.exec(path)
  if (method === 'GET' && watched) {
    const capture = live.get(watched[1])
    return capture === undefined ? send(res, 404, 'Not a live capture') : sendJson(res, 200, capture)
  }
  if (method === 'GET' && path === '/api/reports') return sendJson(res, 200, await store.list())
  if (method === 'POST' && path === '/api/reports/import') {
    const result = await importBody(await readRequest(req), store)
    if (result.status === 201) return sendJson(res, 201, result.report)
    if (result.status === 415) return send(res, 415, result.error ?? '')
    return sendJson(res, result.status, { error: result.error, errors: result.errors })
  }
  // The bundled sample trace, which the list page imports through the import route above.
  if (method === 'GET' && path === '/samples/sample-trace.json') {
    return send(res, 200, await readSample(), 'application/json')
  }
  if (method === 'POST' && path === '/api/reports/bulk-delete') {
    const ids = parseIds(await readRequest(req))
    if (ids === undefined) return send(res, 400, `Expected {"ids": [...]} with 1 to ${MAX_BULK_IDS} report ids`)
    const result = await store.deleteAll(ids)
    return sendJson(res, 200, result)
  }
  // TODO(#186): a side-by-side diff of two stored reports.
  if (method === 'GET' && path === '/api/diff') return send(res, 501, 'Diff is not implemented yet (#186)')
  if (report && method === 'GET') {
    const json = await store.get(report[1])
    return json === undefined ? send(res, 404, 'No such report') : send(res, 200, json, 'application/json')
  }
  // Idempotent: deleting a report that is already gone succeeds too. Only a malformed id is refused.
  if (report && method === 'DELETE') {
    if (!isReportId(report[1])) return send(res, 400, 'Not a report id')
    await store.delete(report[1])
    return send(res, 204, '')
  }
  return send(res, 404, 'Not found')
}

/**
 * Live captures over a WebSocket, in the lsd-live protocol (protocol/lsd-live.schema.json, #152).
 * The interface is the protocol, not any one capture library: anything that captures interactions
 * connects, says hello and sends events. Each connection builds one report, stored like an import.
 * Messages on one socket are handled in order.
 */
function attachCaptures(server: Server, store: ReportStore, live: LiveReports): void {
  const sockets = new WebSocketServer({ server, path: CAPTURES_PATH, maxPayload: DEFAULT_MAX_BODY_BYTES })
  sockets.on('connection', (socket) => {
    const session = new CaptureSession(store, live)
    let queue: Promise<unknown> = Promise.resolve()
    let closing = false
    socket.on('message', (data: Buffer, binary: boolean) => {
      queue = queue.then(async () => {
        if (closing) return
        const outcome = binary
          ? { replies: [{ type: 'error', code: 'invalid-json', message: 'Send text frames' }] }
          : await session.receive(data.toString('utf8'))
        for (const reply of outcome.replies) socket.send(JSON.stringify(reply))
        if (outcome.close !== undefined) {
          closing = true
          socket.close(outcome.close)
        }
      })
    })
    socket.on('close', () => {
      queue = queue.then(() => session.closed())
    })
  })
  server.on('close', () => sockets.close())
}

/** The bulk delete body: `{"ids": [...]}` with 1 to MAX_BULK_IDS strings, else undefined. */
function parseIds(body: string): string[] | undefined {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return undefined
  }
  const ids = (json as { ids?: unknown } | null)?.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK_IDS) return undefined
  return ids.every((id): id is string => typeof id === 'string') ? ids : undefined
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) return reject(new BodyTooLarge())
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        req.pause()
        return reject(new BodyTooLarge())
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type })
  res.end(body)
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), 'application/json')
}
