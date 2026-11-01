// Builds the report viewer the server opens reports in, and copies it to viewer/lsd-report.html
// (gitignored, shipped in the package). Runs as `prepare` (npm install and npm ci in a checkout)
// and `prepack`. The viewer is the report UI's single-file build from
// modules/lsd-mono-report-html/ui (`npm ci`, `npm run build:single`).
//
//   --required   fail when there is no viewer afterwards (prepack: a package must ship one)
//   --force      build even when the copy is up to date
//
// Without --required a failed build only warns, so installing still works and the server shows
// its "Report viewer not built" page. LSD_STUDIO_SKIP_VIEWER=1 (or the older LSD_SERVER_SKIP_VIEWER=1)
// skips the build (the studio CI job, whose tests use their own viewer stand-in).
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UI = resolve(SERVER, '../lsd-mono-report-html/ui')
const DIST = join(UI, 'dist', 'lsd-report.html')
const OUT = join(SERVER, 'viewer', 'lsd-report.html')
// What the build reads. node_modules, dist and test output are left out.
const INPUTS = [
  'src',
  'public',
  'scripts',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
]
const SHELL_READS = 'window.__LSD_REPORT__??'

const args = process.argv.slice(2)
const required = args.includes('--required')
const force = args.includes('--force')
const log = (message) => console.log(`LSD Studio viewer: ${message}`)

function newest(path) {
  if (!existsSync(path)) return 0
  const stat = statSync(path)
  if (!stat.isDirectory()) return stat.mtimeMs
  return readdirSync(path).reduce((max, name) => Math.max(max, newest(join(path, name))), stat.mtimeMs)
}

const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : -1)
const isViewer = (path) => existsSync(path) && readFileSync(path, 'utf8').includes(SHELL_READS)

function npm(...npmArgs) {
  const result = spawnSync('npm', npmArgs, { cwd: UI, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`npm ${npmArgs.join(' ')} in ${UI} failed`)
}

function copy() {
  mkdirSync(dirname(OUT), { recursive: true })
  copyFileSync(DIST, OUT)
  if (!isViewer(OUT)) throw new Error(`${DIST} is not the report viewer`)
}

function build() {
  const skip = process.env.LSD_STUDIO_SKIP_VIEWER ?? process.env.LSD_SERVER_SKIP_VIEWER
  if (skip === '1' && !required) return log('skipped (LSD_STUDIO_SKIP_VIEWER=1)')
  if (!existsSync(join(UI, 'package.json'))) {
    // Installed from the package: the viewer came with it.
    if (isViewer(OUT)) return
    throw new Error(`no report UI at ${UI} to build the viewer from`)
  }
  const sources = Math.max(...INPUTS.map((input) => newest(join(UI, input))))
  if (!force && isViewer(OUT) && mtime(OUT) >= sources) return log('up to date')
  if (!force && isViewer(DIST) && mtime(DIST) >= sources) {
    copy()
    return log(`copied the report UI's build to ${OUT}`)
  }
  log('building the report UI')
  if (mtime(join(UI, 'node_modules', '.package-lock.json')) < mtime(join(UI, 'package-lock.json'))) npm('ci')
  npm('run', 'build:single')
  copy()
  log(`built ${OUT}`)
}

try {
  build()
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  if (required) {
    console.error(`LSD Studio viewer: ${reason}`)
    process.exit(1)
  }
  console.warn(
    `\nWARNING LSD Studio viewer: ${reason}.\n` +
      'LSD Studio still runs, but opening a report shows "Report viewer not built" until\n' +
      '`npm run build:viewer` succeeds in modules/lsd-mono-studio.\n',
  )
}
