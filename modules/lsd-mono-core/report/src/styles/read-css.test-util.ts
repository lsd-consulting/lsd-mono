import { readFileSync } from 'node:fs'

/**
 * app.css as the browser sees it: its area files inlined in import order. tokens.css stays
 * an @import line, as tests read the tokens on their own.
 */
export function readAppCss(): string {
  const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
  return read('app.css').replace(/@import "\.\/((?!tokens)[\w-]+\.css)";\n/g, (_: string, file: string) => read(file))
}
