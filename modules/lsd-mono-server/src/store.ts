import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A report the server keeps. TODO(#186): add a title, a source (import or capture) and a date. */
export interface StoredReport {
  id: string
}

/**
 * Where the server keeps reports. Cleanup is manual (#186): a delete per report and a bulk delete,
 * with no maximum count and no auto-expiry.
 */
export interface ReportStore {
  list(): Promise<StoredReport[]>
  get(id: string): Promise<string | undefined>
  /** Stores the report JSON and returns its new id. */
  save(json: string): Promise<string>
  delete(id: string): Promise<boolean>
  /** Deletes each id that exists and returns how many were deleted. */
  deleteAll(ids: readonly string[]): Promise<number>
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Keeps each report as `<id>.json` in a directory the server owns (defaultReportsDir).
 * TODO(#186): settle the storage format inside the directory.
 */
export class FileReportStore implements ReportStore {
  private readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  async list(): Promise<StoredReport[]> {
    const names = await readdir(this.dir).catch(() => [] as string[])
    return names
      .filter((name) => name.endsWith('.json') && ID.test(name.slice(0, -5)))
      .map((name) => ({ id: name.slice(0, -5) }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  async get(id: string): Promise<string | undefined> {
    const file = this.fileFor(id)
    return file === undefined ? undefined : readFile(file, 'utf8').catch(() => undefined)
  }

  async save(json: string): Promise<string> {
    await mkdir(this.dir, { recursive: true })
    const id = randomUUID()
    await writeFile(join(this.dir, `${id}.json`), json)
    return id
  }

  async delete(id: string): Promise<boolean> {
    if ((await this.get(id)) === undefined) return false
    await rm(this.fileFor(id)!)
    return true
  }

  async deleteAll(ids: readonly string[]): Promise<number> {
    let deleted = 0
    for (const id of ids) if (await this.delete(id)) deleted++
    return deleted
  }

  // Only ids this store made, so an id can never point outside the directory.
  private fileFor(id: string): string | undefined {
    return ID.test(id) ? join(this.dir, `${id}.json`) : undefined
  }
}
