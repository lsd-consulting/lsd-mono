import { readFile } from 'node:fs/promises'

/**
 * The report UI's single-file shell, as lsd-mono-report-html builds it (`npm run build:single` in
 * modules/lsd-mono-report-html/ui). The server reuses it as is, the same way lsd-mono-jvm writes a
 * report page: the report goes in as `window.__LSD_REPORT__` before the shell's first script, and
 * the shell reads it, upgrading a 0.x report on the way (upgradeLegacyReport).
 */
export const DEFAULT_SHELL = new URL('../../lsd-mono-report-html/ui/dist/lsd-report.html', import.meta.url)

const SHELL_READS = 'window.__LSD_REPORT__??'

/** Reads the shell, or undefined when it isn't built (or isn't the report shell). */
export async function readShell(shell: URL): Promise<string | undefined> {
  const html = await readFile(shell, 'utf8').catch(() => undefined)
  return html?.includes(SHELL_READS) ? html : undefined
}

/**
 * [json] as a JavaScript literal that is safe inside a `<script>` element: `<`, `>`, `&` and
 * U+2028/U+2029 are escaped, so no report text can end the script.
 */
export function scriptJson(json: string): string {
  return JSON.stringify(JSON.parse(json) as unknown).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

// A link back to the server's list, fixed at the bottom left so it sits outside the report UI's
// own layout (which only renders into #app).
const BACK_LINK =
  '<a id="lsd-server-back" href="/" style="position:fixed;left:12px;bottom:12px;z-index:2147483647;' +
  'padding:6px 12px;border-radius:6px;background:#1f2937;color:#fff;font:14px system-ui,sans-serif;' +
  'text-decoration:none;box-shadow:0 1px 4px rgba(0,0,0,.3)">&larr; All reports</a>\n'

/** The shell with [json] as its report and a back link to the list. */
export function renderReportPage(shell: string, json: string): string {
  const injection = `<script>window.__LSD_REPORT__=${scriptJson(json)};</script>\n`
  const script = shell.indexOf('<script>')
  const page = script < 0 ? injection + shell : shell.slice(0, script) + injection + shell.slice(script)
  const body = page.lastIndexOf('</body>')
  return body < 0 ? page + BACK_LINK : page.slice(0, body) + BACK_LINK + page.slice(body)
}

/** The pages shown when there is no report to show. Fixed text only: nothing from the request. */
export const MESSAGES = {
  notFound: ['Report not found', 'There is no stored report with that id. It may have been deleted.'],
  noShell: [
    'Report viewer not built',
    'Build the report UI once: npm ci and npm run build:single in modules/lsd-mono-report-html/ui.',
  ],
} as const

/** A small page with one of [MESSAGES] and a link back to the list. */
export function messagePage([title, message]: (typeof MESSAGES)[keyof typeof MESSAGES]): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${title} - LSD server</title></head>
  <body style="font:16px system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="/">&larr; All reports</a></p>
  </body>
</html>
`
}
