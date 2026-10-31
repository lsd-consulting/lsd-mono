import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MESSAGES, messagePage, readShell, renderReportPage, scriptJson } from './viewer.ts'

const SHELL =
  '<html><head><script>x</script></head><body><div id="app"></div><script>const r=window.__LSD_REPORT__??s</script></body></html>'

describe('the report viewer', () => {
  it('puts the report before the shell script and a back link before </body>', () => {
    const page = renderReportPage(SHELL, '{"title":"t"}')
    expect(page.indexOf('window.__LSD_REPORT__={"title":"t"};')).toBeLessThan(page.indexOf('<script>x'))
    expect(page).toMatch(/<a id="lsd-server-back" href="\/"[^>]*>&larr; All reports<\/a>\n<\/body>/)
  })

  it('works on a shell with no script or body', () => {
    expect(renderReportPage('<p>', '{}')).toMatch(
      /^<script>window.__LSD_REPORT__=\{\};<\/script>\n<p><a id="lsd-server-back"/,
    )
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

  it('has message pages that link back to the list', () => {
    expect(messagePage(MESSAGES.notFound)).toMatch(/<h1>Report not found<\/h1>[\s\S]*<a href="\/">/)
  })
})
