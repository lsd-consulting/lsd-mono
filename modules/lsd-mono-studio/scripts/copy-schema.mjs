// Copies the repo's report schema (modules/lsd-mono-report-schema/lsd-report.schema.json) to
// schema/lsd-report.schema.json (gitignored, shipped in the package), so an installed package can
// validate imports. Runs in `prepare` and `prepack`. Installed from the package, there is no repo
// schema and the shipped copy is used as it is.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FROM = resolve(STUDIO, '../lsd-mono-report-schema/lsd-report.schema.json')
const TO = join(STUDIO, 'schema', 'lsd-report.schema.json')

if (existsSync(FROM)) {
  mkdirSync(dirname(TO), { recursive: true })
  copyFileSync(FROM, TO)
} else if (!existsSync(TO)) {
  console.error(`LSD Studio schema: no report schema at ${FROM}`)
  process.exit(1)
}
