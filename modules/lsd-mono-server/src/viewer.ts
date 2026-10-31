import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The report UI's single-file shell, as lsd-mono-report-html builds it (`npm run build:single` in
 * modules/lsd-mono-report-html/ui). The server reuses it as is, the same way lsd-mono-jvm writes a
 * report page: the report goes in as `window.__LSD_REPORT__` before the shell's first script, and
 * the shell reads it, upgrading a 0.x report on the way (upgradeLegacyReport).
 */
export const DEFAULT_SHELL = new URL('../../lsd-mono-report-html/ui/dist/lsd-report.html', import.meta.url)

/** The copy `npm install` builds (scripts/build-viewer.mjs) and the package ships. */
export const BUNDLED_SHELL = new URL('../viewer/lsd-report.html', import.meta.url)

/**
 * Where the server looks for the shell, in order: an explicit [override] (a path, relative to the
 * working directory), the bundled copy, then the report UI's own build in the checkout.
 */
export function viewerShells(override?: string): URL[] {
  const bundled = [BUNDLED_SHELL, DEFAULT_SHELL]
  return override === undefined ? bundled : [pathToFileURL(resolve(override)), ...bundled]
}

const SHELL_READS = 'window.__LSD_REPORT__??'

/** The first of [shells] that is the report shell, or undefined when none is built. */
export async function findShell(shells: readonly URL[]): Promise<string | undefined> {
  for (const shell of shells) {
    const html = await readShell(shell)
    if (html !== undefined) return html
  }
  return undefined
}

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

// A bar with a link back to the server's list, first in the body so it is first in tab order and
// takes its own space above the report UI (which only renders into #app), rather than covering it.
// Hidden in print. The tab title is set after the shell's scripts, from the report itself.
const BACK_BAR =
  '<style>#lsd-server-back{display:block;padding:6px 12px;background:#1f2937;color:#fff;' +
  'font:14px system-ui,sans-serif;text-decoration:none}#lsd-server-back:focus-visible{outline:2px solid #7dd3fc;' +
  'outline-offset:-2px}@media print{#lsd-server-back{display:none}}</style>\n' +
  '<a id="lsd-server-back" href="/">&larr; All reports</a>\n'

const TAB_TITLE =
  "<script>document.title=(window.__LSD_REPORT__&&typeof window.__LSD_REPORT__.title==='string'&&" +
  "window.__LSD_REPORT__.title.trim()||'Untitled report')+' – LSD server';</script>\n"

/** The shell with [json] as its report, a back bar to the list and a "<title> – LSD server" tab. */
export function renderReportPage(shell: string, json: string): string {
  const injection = `<script>window.__LSD_REPORT__=${scriptJson(json)};</script>\n`
  const script = shell.indexOf('<script>')
  let page = script < 0 ? injection + shell : shell.slice(0, script) + injection + shell.slice(script)
  const open = /<body[^>]*>/.exec(page)
  page =
    open === null
      ? BACK_BAR + page
      : page.slice(0, open.index + open[0].length) + '\n' + BACK_BAR + page.slice(open.index + open[0].length)
  const body = page.lastIndexOf('</body>')
  return body < 0 ? page + TAB_TITLE : page.slice(0, body) + TAB_TITLE + page.slice(body)
}

interface Message {
  title: string
  message: string
  /** Commands to run, shown as a code block. */
  steps?: { folder: string; commands: string[] }
}

/** The pages shown when there is no report to show. Fixed text only: nothing from the request. */
export const MESSAGES = {
  notFound: { title: 'Report not found', message: 'There is no stored report with that id. It may have been deleted.' },
  noShell: {
    title: 'Report viewer not built',
    message:
      'The server opens reports in the report UI, which installing the server normally builds. That step was skipped or failed. From the lsd-mono checkout, run this, then reload this page:',
    steps: { folder: 'modules/lsd-mono-server', commands: ['npm run build:viewer'] },
  },
} as const satisfies Record<string, Message>

/** A small page with one of [MESSAGES] and a link back to the list, in light or dark. */
export function messagePage({ title, message, steps }: Message): string {
  const code = steps ? `\n    <pre><code>cd ${steps.folder}\n${steps.commands.join('\n')}</code></pre>` : ''
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${title} - LSD server</title>
    <style>
      body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;background:#f5f7fa;color:#1f2733}
      a{color:#0b6e7f}
      pre{background:#fff;border:1px solid #d5dbe3;border-radius:8px;padding:0.75rem 1rem;overflow-x:auto}
      @media (prefers-color-scheme: dark){
        body{background:#151b24;color:#eef1f5}
        a{color:#6fd3e3}
        pre{background:#212a36;border-color:#3a4554}
      }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>${message}</p>${code}
    <p><a href="/">&larr; All reports</a></p>
  </body>
</html>
`
}
