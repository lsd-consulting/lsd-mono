import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url).pathname
const dist = join(root, 'dist')
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const jsMatch = html.match(/src="\.\/assets\/([^"]+\.js)"/)
const cssMatch = html.match(/href="\.\/assets\/([^"]+\.css)"/)
if (!jsMatch || !cssMatch) throw new Error('Could not find assets in dist/index.html')
const js = readFileSync(join(dist, 'assets', jsMatch[1]), 'utf8')
const css = readFileSync(join(dist, 'assets', cssMatch[1]), 'utf8')
const favicon = readFileSync(join(dist, 'favicon.svg'), 'utf8')
// The pre-paint theme script from index.html, so both pages pick the theme the same way.
const themeBoot = html.match(/ *<script data-theme-boot>[\s\S]*?<\/script>\n/)
if (!themeBoot) throw new Error('Could not find the theme boot script in dist/index.html')
const faviconData = 'data:image/svg+xml,' + encodeURIComponent(favicon)

if (/<\/script|<!--/i.test(js)) {
  throw new Error('the bundle contains </script or <!--, which would end or confuse its inline <script>')
}
// Classic <script> (not type=module): Vite chunk is already an IIFE — works on file://.
const single = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
${themeBoot[0]}    <title>LSD Report — Living Sequence Diagrams</title>
    <link rel="icon" href="${faviconData}" type="image/svg+xml" />
    <style>
/* Fonts: Inter (Copyright 2016 The Inter Project Authors) and JetBrains Mono (Copyright 2020 The JetBrains Mono Project Authors), embedded under the SIL Open Font License 1.1: https://openfontlicense.org */
${css}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>
${js}
    </script>
  </body>
</html>
`
// #64, lsd.mono.report.assets=shared: the same app as separate files, which the report writer
// copies into a report directory once, under content-hashed names, for every page there to load.
// The page template references them as lsd-report.css and lsd-report.js; the writer puts in the
// hashed names, its report's <meta name="lsd-report"> and its <stem>-report.js. Classic scripts,
// in the same directory as the page, so they load from file:// in every browser.
const fontNotice =
  '/* Fonts: Inter (Copyright 2016 The Inter Project Authors) and JetBrains Mono (Copyright 2020 The JetBrains Mono Project Authors), embedded under the SIL Open Font License 1.1: https://openfontlicense.org */\n'
const sharedPage = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
${themeBoot[0]}    <title>LSD Report — Living Sequence Diagrams</title>
    <link rel="icon" href="${faviconData}" type="image/svg+xml" />
    <link rel="stylesheet" href="lsd-report.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="lsd-report.js"></script>
  </body>
</html>
`
const sharedDir = join(dist, 'shared')
mkdirSync(sharedDir, { recursive: true })
writeFileSync(join(sharedDir, 'lsd-report.js'), js)
writeFileSync(join(sharedDir, 'lsd-report.css'), fontNotice + css)
writeFileSync(join(dist, 'lsd-report.shared.html'), sharedPage)
console.log('Wrote', join(dist, 'lsd-report.shared.html'), 'and', sharedDir)

const out = join(dist, 'lsd-report.html')
writeFileSync(out, single)
if (js.includes('import.meta') || js.includes('pm_visa')) {
  throw new Error('single-file shell still contains a module import or a demo payload body')
}
const payloadsMod = await import(pathToFileURL(join(root, 'src/data/sample-payloads.ts')).href)
const { payloadTextScript } = await import(pathToFileURL(join(root, 'src/lib/payloads.ts')).href)
const payloadJs = payloadTextScript(payloadsMod.samplePayloads)
// Beside the shell: with no captured report it shows the built-in demo, which loads these.
const payloadOut = join(dist, 'lsd-report-payloads.js')
writeFileSync(payloadOut, payloadJs)
console.log('Wrote', out, `(${(single.length / 1024).toFixed(1)} KB)`)
console.log('Wrote', payloadOut, `(${(payloadJs.length / 1024).toFixed(1)} KB)`)
