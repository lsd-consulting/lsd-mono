import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

/** [name] with its @import lines replaced by the files, in import order. tokens.css stays an @import line. */
function inlined(name: string): string {
  return read(name).replace(/@import "\.\/((?!tokens)[\w-]+\.css)";\n/g, (_: string, file: string) => read(file))
}

/**
 * app.css as the browser sees it: its area files inlined in import order. tokens.css stays
 * an @import line, as tests read the tokens on their own.
 */
export function readAppCss(): string {
  return inlined('app.css')
}

/** diagram.css as the browser sees it: its feature files inlined in import order (#98). */
export function readDiagramCss(): string {
  return inlined('diagram.css')
}
