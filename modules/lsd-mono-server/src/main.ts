import { parseConfig } from './config.ts'
import { startServer } from './server.ts'
import { FileReportStore } from './store.ts'

// `npm start`, or `npm start -- --port 8080 --expose`.
const config = parseConfig(process.argv.slice(2), process.env)
const { address } = await startServer(config, new FileReportStore(config.reportsDir))
console.log(`LSD server on http://${address.address}:${address.port} (reports in ${config.reportsDir})`)
