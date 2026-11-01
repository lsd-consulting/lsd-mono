import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * How the server starts. Secure by default (#186): it binds to localhost only, and only the
 * explicit `--expose` flag (or LSD_STUDIO_EXPOSE=1) binds it to every interface.
 *
 * No access control yet. TODO(#186): add it as a future feature, once the expose flag is in use.
 */
export interface ServerConfig {
  host: string
  port: number
  reportsDir: string
  /** A report viewer to try first (`--viewer <file>` or LSD_STUDIO_VIEWER), for UI development. */
  viewer?: string
}

export const LOCALHOST = '127.0.0.1'
export const ALL_INTERFACES = '0.0.0.0'
export const DEFAULT_PORT = 7357

/** TODO(#186): the server-owned directory is hard-coded for v1; make it configurable later. */
export const defaultReportsDir = (): string => join(homedir(), '.lsd', 'server', 'reports')

/**
 * Reads `--expose`, `--port <n>` (or `--port=<n>`) and `--viewer <file>` (or `--viewer=<file>`), and
 * LSD_STUDIO_EXPOSE / LSD_STUDIO_PORT / LSD_STUDIO_VIEWER. The LSD_SERVER_* names from before the
 * rename still work; an LSD_STUDIO_* one wins.
 */
export function parseConfig(args: readonly string[], env: NodeJS.ProcessEnv = {}): ServerConfig {
  const expose = env.LSD_STUDIO_EXPOSE ?? env.LSD_SERVER_EXPOSE
  const envPort = env.LSD_STUDIO_PORT ?? env.LSD_SERVER_PORT
  let host = expose === '1' ? ALL_INTERFACES : LOCALHOST
  let port = envPort === undefined ? DEFAULT_PORT : parsePort(envPort)
  let viewer = (env.LSD_STUDIO_VIEWER ?? env.LSD_SERVER_VIEWER) || undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--expose') host = ALL_INTERFACES
    else if (arg === '--port') port = parsePort(args[++i])
    else if (arg.startsWith('--port=')) port = parsePort(arg.slice('--port='.length))
    else if (arg === '--viewer') viewer = parseViewer(args[++i])
    else if (arg.startsWith('--viewer=')) viewer = parseViewer(arg.slice('--viewer='.length))
    else throw new Error(`Unknown option '${arg}'. Options: --expose, --port <n>, --viewer <file>`)
  }
  return { host, port, reportsDir: defaultReportsDir(), ...(viewer === undefined ? {} : { viewer }) }
}

function parseViewer(value: string | undefined): string {
  if (value === undefined || value === '') throw new Error('--viewer needs a file, the report UI single-file build')
  return value
}

function parsePort(value: string | undefined): number {
  const port = Number(value)
  if (value === undefined || value === '' || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port needs a number from 0 to 65535, was '${value}'`)
  }
  return port
}
