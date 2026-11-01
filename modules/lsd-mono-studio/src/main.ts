import { parseConfig } from './config.ts'
import { importSampleOnce } from './sample.ts'
import { startServer } from './server.ts'
import { FileReportStore } from './store.ts'

// `npm start`, or `npm start -- --port 8080 --expose --demo`.
const config = parseConfig(process.argv.slice(2), process.env)
const store = new FileReportStore(config.reportsDir)
const { address } = await startServer(config, store)
const base = `http://${address.address}:${address.port}`
console.log(`LSD Studio on ${base} (reports in ${config.reportsDir})`)
if (config.demo) {
  const { imported, report, result } = await importSampleOnce(store)
  if (report === undefined) console.error(`LSD Studio: the sample trace did not import: ${result?.error ?? 'unknown'}`)
  else console.log(`${imported ? 'Imported' : 'Already have'} the sample trace: ${base}/reports/${report.id}`)
}
