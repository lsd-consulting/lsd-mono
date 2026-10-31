import { runInNewContext } from 'node:vm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_SHELL,
  DEFAULT_SHELL,
  MESSAGES,
  messagePage,
  readShell,
  renderReportPage,
  scriptJson,
  viewerShells,
} from './viewer.ts'

const SHELL =
  '<html><head><script>x</script></head><body><div id="app"></div><script>const r=window.__LSD_REPORT__??s</script></body></html>'

describe('the report viewer', () => {
  it('puts the report before the shell script, the back link first in the body', () => {
    const page = renderReportPage(SHELL, '{"title":"t"}')
    expect(page.indexOf('window.__LSD_REPORT__={"title":"t"};')).toBeLessThan(page.indexOf('<script>x'))
    expect(page).toMatch(
      /<body>\n<style>[^<]*@media print\{#lsd-server-back\{display:none\}\}<\/style>\n<a id="lsd-server-back" href="\/">&larr; All reports<\/a>\n<div id="app">/,
    )
    expect(page.indexOf('document.title=')).toBeGreaterThan(page.indexOf('const r='))
    expect(page).toMatch(/<\/script>\n<\/body>/)
  })

  it('works on a shell with no script or body', () => {
    const page = renderReportPage('<p>', '{}')
    expect(page).toMatch(
      /^<style>[\s\S]*<a id="lsd-server-back"[^\n]*\n<script>window.__LSD_REPORT__=\{\};<\/script>\n<p>/,
    )
    expect(page).toMatch(/<p><script>document\.title=[^\n]*<\/script>\n$/)
  })

  it('titles the tab after the report, or Untitled report', () => {
    const title = (json: string) => {
      const script = /<script>(document\.title=[^<]*)<\/script>/.exec(renderReportPage(SHELL, json))![1]
      const context = { window: { __LSD_REPORT__: JSON.parse(json) as unknown }, document: { title: '' } }
      runInNewContext(script, context)
      return context.document.title
    }
    expect(title('{"title":"Checkout"}')).toBe('Checkout – LSD server')
    expect(title('{"title":"  "}')).toBe('Untitled report – LSD server')
    expect(title('{"title":5}')).toBe('Untitled report – LSD server')
  })

  it('escapes what could end the script', () => {
    const json = JSON.stringify({ title: '</script><!-- & \u2028\u2029' })
    expect(scriptJson(json)).toBe('{"title":"\\u003c/script\\u003e\\u003c!-- \\u0026 \\u2028\\u2029"}')
    expect(JSON.parse(scriptJson(json))).toEqual(JSON.parse(json))
  })

  it('reads only a built report shell', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lsd-shell-'))
    try {
      await writeFile(join(dir, 'shell.html'), SHELL)
      await writeFile(join(dir, 'other.html'), '<html></html>')
      expect(await readShell(pathToFileURL(join(dir, 'shell.html')))).toBe(SHELL)
      expect(await readShell(pathToFileURL(join(dir, 'other.html')))).toBeUndefined()
      expect(await readShell(pathToFileURL(join(dir, 'missing.html')))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('looks for the override, then the bundled viewer, then the report UI build', () => {
    expect(viewerShells()).toEqual([BUNDLED_SHELL, DEFAULT_SHELL])
    expect(BUNDLED_SHELL.href).toMatch(/\/lsd-mono-server\/viewer\/lsd-report\.html$/)
    expect(DEFAULT_SHELL.href).toMatch(/\/lsd-mono-report-html\/ui\/dist\/lsd-report\.html$/)
    expect(viewerShells('/tmp/mine.html')).toEqual([pathToFileURL('/tmp/mine.html'), BUNDLED_SHELL, DEFAULT_SHELL])
    expect(viewerShells('mine.html')[0]).toEqual(pathToFileURL(join(process.cwd(), 'mine.html')))
  })

  it('has message pages that link back to the list', () => {
    expect(messagePage(MESSAGES.notFound)).toMatch(/<h1>Report not found<\/h1>[\s\S]*<a href="\/">/)
    expect(messagePage(MESSAGES.notFound)).not.toContain('<pre>')
  })

  it('works on phones and in dark mode, and gives the exact build steps', () => {
    const page = messagePage(MESSAGES.noShell)
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />')
    expect(page).toContain('@media (prefers-color-scheme: dark)')
    expect(page).toContain('<pre><code>cd modules/lsd-mono-server\nnpm run build:viewer</code></pre>')
  })
})
