import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Where a stored report came from. Captures arrive over the WebSocket later (#186). */
export type ReportSource = 'import' | 'capture'

/** One entry in the store's index: what the report list shows without opening each report. */
export interface StoredReport {
  id: string
  /** The report's own `title`, or "Untitled report" when it has none. */
  title: string
  /** When the server stored it, as an ISO-8601 instant. */
  importedAt: string
  source: ReportSource
  /** The stored JSON's size in bytes. */
  size: number
}

export interface BulkDeleteResult {
  deleted: string[]
  notFound: string[]
}

/**
 * Where the server keeps reports. Cleanup is manual (#186): a delete per report and a bulk delete,
 * with no maximum count and no auto-expiry.
 */
export interface ReportStore {
  /** The index, newest first. */
  list(): Promise<StoredReport[]>
  get(id: string): Promise<string | undefined>
  /** Stores the report JSON and returns its index entry. */
  save(json: string, source?: ReportSource): Promise<StoredReport>
  delete(id: string): Promise<boolean>
  /** Deletes each id that exists and says which ids were not there. */
  deleteAll(ids: readonly string[]): Promise<BulkDeleteResult>
}

/** Whether an id has the shape this store gives out (a UUID). */
export function isReportId(id: string): boolean {
  return ID.test(id)
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const INDEX = 'index.json'
const UNTITLED = 'Untitled report'

/**
 * Keeps each report as `<id>.json` in a directory the server owns (defaultReportsDir), plus an
 * `index.json` listing them. The index is rewritten whole through a temp file and a rename, and
 * writes are queued, so concurrent requests can't interleave. A directory without an index (made
 * by the scaffold) gets one rebuilt from its report files on first use.
 */
export class FileReportStore implements ReportStore {
  private readonly dir: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(dir: string) {
    this.dir = dir
  }

  async list(): Promise<StoredReport[]> {
    return [...(await this.readIndex())].sort(
      (a, b) => b.importedAt.localeCompare(a.importedAt) || a.id.localeCompare(b.id),
    )
  }

  async get(id: string): Promise<string | undefined> {
    const file = this.fileFor(id)
    return file === undefined ? undefined : readFile(file, 'utf8').catch(() => undefined)
  }

  save(json: string, source: ReportSource = 'import'): Promise<StoredReport> {
    return this.exclusive(async () => {
      const index = await this.readIndex()
      const entry: StoredReport = {
        id: randomUUID(),
        title: titleOf(json),
        importedAt: new Date().toISOString(),
        source,
        size: Buffer.byteLength(json),
      }
      await mkdir(this.dir, { recursive: true })
      await writeFile(join(this.dir, `${entry.id}.json`), json)
      await this.writeIndex([...index, entry])
      return entry
    })
  }

  async delete(id: string): Promise<boolean> {
    return (await this.deleteAll([id])).deleted.length === 1
  }

  deleteAll(ids: readonly string[]): Promise<BulkDeleteResult> {
    return this.exclusive(async () => {
      const index = await this.readIndex()
      const known = new Set(index.map((entry) => entry.id))
      const result: BulkDeleteResult = { deleted: [], notFound: [] }
      for (const id of new Set(ids)) {
        if (!known.has(id)) {
          result.notFound.push(id)
          continue
        }
        await rm(this.fileFor(id)!, { force: true })
        result.deleted.push(id)
      }
      if (result.deleted.length > 0) {
        const gone = new Set(result.deleted)
        await this.writeIndex(index.filter((entry) => !gone.has(entry.id)))
      }
      return result
    })
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async readIndex(): Promise<StoredReport[]> {
    const text = await readFile(join(this.dir, INDEX), 'utf8').catch(() => undefined)
    return text === undefined ? this.rebuildIndex() : (JSON.parse(text) as StoredReport[])
  }

  private async rebuildIndex(): Promise<StoredReport[]> {
    const names = await readdir(this.dir).catch(() => [] as string[])
    const entries: StoredReport[] = []
    for (const name of names) {
      const id = name.slice(0, -5)
      if (!name.endsWith('.json') || !ID.test(id)) continue
      const file = join(this.dir, name)
      const [json, info] = await Promise.all([readFile(file, 'utf8'), stat(file)])
      entries.push({
        id,
        title: titleOf(json),
        importedAt: info.mtime.toISOString(),
        source: 'import',
        size: info.size,
      })
    }
    return entries
  }

  private async writeIndex(entries: StoredReport[]): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const temp = join(this.dir, `${INDEX}.${randomUUID()}.tmp`)
    await writeFile(temp, JSON.stringify(entries, null, 2))
    await rename(temp, join(this.dir, INDEX))
  }

  // Only ids this store made, so an id can never point outside the directory.
  private fileFor(id: string): string | undefined {
    return ID.test(id) ? join(this.dir, `${id}.json`) : undefined
  }
}

function titleOf(json: string): string {
  try {
    const title = (JSON.parse(json) as { title?: unknown }).title
    return typeof title === 'string' && title.trim() !== '' ? title.trim() : UNTITLED
  } catch {
    return UNTITLED
  }
}
