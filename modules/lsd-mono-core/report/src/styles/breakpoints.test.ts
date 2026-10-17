import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PHONE_MAX_PX, STACKED_MAX_PX } from '../lib/media'

describe('breakpoints', () => {
  it('uses only the widths in lib/media.ts in @media rules', () => {
    const allowed = new Set([PHONE_MAX_PX, STACKED_MAX_PX, STACKED_MAX_PX + 1])
    const dir = new URL('./', import.meta.url)
    const found: string[] = []
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
      const css = readFileSync(new URL(file, dir), 'utf8')
      for (const m of css.matchAll(/@media[^{]*?\((?:max|min)-width:\s*(\d+)px\)/g))
        if (!allowed.has(Number(m[1]))) found.push(`${file}: ${m[0]}`)
    }
    expect(found).toEqual([])
  })
})
