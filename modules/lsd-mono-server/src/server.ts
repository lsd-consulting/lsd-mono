import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import type { ServerConfig } from './config.ts'
import { detectImport } from './import.ts'
import { isReportId, type ReportStore } from './store.ts'

const INDEX_HTML = new URL('../public/index.html', import.meta.url)
const CAPTURES_PATH = '/ws/captures'
export const MAX_BULK_IDS = 1000

export interface LsdServer {
  server: Server
  address: AddressInfo
  close(): Promise<void>
}

/** Starts the server on the config's host and port (port 0 picks a free one). */
export async function startServer(config: ServerConfig, store: ReportStore): Promise<LsdServer> {
  const server = createServer((req, res) => {
    route(req, res, store).catch((error: unknown) => send(res, 500, String(error)))
  })
  attachCaptures(server)
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
async function route(req: IncomingMessage, res: ServerResponse, store: ReportStore): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  const method = req.method ?? 'GET'
  const report = /^\/api\/reports\/([^/]+)$/.exec(path)

  if (method === 'GET' && path === '/health') return send(res, 200, 'ok')
  if (method === 'GET' && path === '/') return send(res, 200, await readFile(INDEX_HTML, 'utf8'), 'text/html')
  if (method === 'GET' && path === '/api/reports') return sendJson(res, 200, await store.list())
  if (method === 'POST' && path === '/api/reports/import') {
    const body = await readBody(req)
    switch (detectImport(body)) {
      case 'lsd-report':
        return sendJson(res, 201, await store.save(body, 'import'))
      case 'otlp':
        // TODO(#186): map with otlpToReport (#96), then store it like any report.
        return send(res, 501, 'OTLP import is not implemented yet (#186)')
      default:
        return send(res, 415, 'Not an LSD report or OTLP JSON')
    }
  }
  if (method === 'POST' && path === '/api/reports/bulk-delete') {
    const ids = parseIds(await readBody(req))
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
 * Real-time captures over a WebSocket. The interface is the protocol, not any one capture library:
 * anything that captures interactions (for example a Ktor filter pointed at this server) connects
 * and sends events. TODO(#186): define the message shape (the report schema's event shape or
 * something smaller, see #152), store the captures and push them to open UI pages.
 */
function attachCaptures(server: Server): void {
  const sockets = new WebSocketServer({ server, path: CAPTURES_PATH })
  sockets.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello', protocol: 'lsd-captures', version: 0 }))
    socket.on('message', () => {
      // TODO(#186): parse and handle capture messages.
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
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
