import { readFile } from 'node:fs/promises'
import { importBody, type ImportResult } from './import.ts'
import { otlpToReport } from './otlp.ts'
import type { ReportStore, StoredReport } from './store.ts'

/**
 * The sample trace the package ships (samples/sample-trace.json): a made-up order placed through
 * four services, as OTLP/JSON. The list page's "Try a sample" button imports it, and `--demo`
 * imports it at startup.
 */
export const SAMPLE_TRACE = new URL('../samples/sample-trace.json', import.meta.url)

export const readSample = (): Promise<string> => readFile(SAMPLE_TRACE, 'utf8')

/** The stored report the sample converts to, if the store has one. */
async function findSample(store: ReportStore, body: string): Promise<StoredReport | undefined> {
  const title = otlpToReport(body).report?.title
  return (await store.list()).find((entry) => entry.source === 'otlp' && entry.title === title)
}

/**
 * `--demo`: imports the sample unless the store already has it, so repeated runs add it once. A
 * sample that was deleted is imported again on the next run.
 */
export async function importSampleOnce(
  store: ReportStore,
): Promise<{ imported: boolean; report: StoredReport | undefined; result?: ImportResult }> {
  const body = await readSample()
  const existing = await findSample(store, body)
  if (existing !== undefined) return { imported: false, report: existing }
  const result = await importBody(body, store)
  return { imported: result.status === 201, report: result.report, result }
}
