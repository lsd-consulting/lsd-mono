// No runtime import cycle through the diagram core (#100). Type-only imports are erased and do
// not count. Cheaper than a dependency for it: the imports are read from the source.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(process.cwd(), 'src')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.ts$/.test(name) && !/\.test(-util)?\.ts$|\.d\.ts$/.test(name) ? [path] : []
  })
}

/** Relative modules [file] imports or re-exports at run time. */
function runtimeImports(text: string): string[] {
  const out: string[] = []
  // `import x from`, `import { a } from`, `export { a } from`, `export * from`, and bare `import '...'`.
  const re = /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"](\.[^'"]+)['"]|^\s*import\s+['"](\.[^'"]+)['"]/gm
  for (const m of text.matchAll(re)) {
    if (m[5]) {
      out.push(m[5])
      continue
    }
    if (m[2]) continue
    // `import { type A, type B } from` is type-only too.
    const names = m[3]
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (m[3].startsWith('{') && names.length && names.every((n) => n.startsWith('type '))) continue
    out.push(m[4])
  }
  return out
}

/** Assets (CSS and the like) are not modules this check follows. */
const ASSET = /\.(css|json|svg|html|txt)(\?.*)?$/

/**
 * The source file a relative [spec] in [from] loads: `./a`, `./a.js` and `./a.ts` are all
 * `a.ts`, and a folder is its `index.ts`. Null when nothing matches.
 */
function resolveImport(from: string, spec: string, known: ReadonlySet<string>): string | null {
  const base = resolve(dirname(from), spec.replace(/\.(js|ts)$/, ''))
  return [`${base}.ts`, join(base, 'index.ts')].find((path) => known.has(path)) ?? null
}

/** The import graph of src, and the relative imports it could not resolve (each a blind spot). */
function graph(): { edges: Map<string, string[]>; unresolved: string[] } {
  const files = sources(SRC)
  const known = new Set(files)
  const edges = new Map<string, string[]>()
  const unresolved: string[] = []
  for (const file of files) {
    const to: string[] = []
    for (const spec of runtimeImports(readFileSync(file, 'utf8'))) {
      if (ASSET.test(spec)) continue
      const path = resolveImport(file, spec, known)
      if (path === null) unresolved.push(`${relative(SRC, file)}: ${spec}`)
      else to.push(path)
    }
    edges.set(file, to)
  }
  return { edges, unresolved }
}

/** Every cycle (as a path) that passes through a file [inScope] accepts. */
function cycles(edges: Map<string, string[]>, inScope: (file: string) => boolean): string[][] {
  const found: string[][] = []
  const seen = new Set<string>()
  for (const start of edges.keys()) {
    if (!inScope(start)) continue
    const stack: string[] = []
    const visit = (node: string) => {
      if (node === start && stack.length) {
        const key = [...stack].sort().join()
        if (!seen.has(key)) {
          seen.add(key)
          found.push([...stack, start].map((f) => relative(SRC, f)))
        }
        return
      }
      if (stack.includes(node) || stack.length > 12) return
      stack.push(node)
      for (const next of edges.get(node) ?? []) visit(next)
      stack.pop()
    }
    visit(start)
  }
  return found
}

const core = (file: string) => {
  const rel = relative(SRC, file)
  return rel === join('lib', 'sequence-diagram.ts') || rel.startsWith(join('lib', 'diagram') + '/')
}

describe('diagram imports', () => {
  it('reads runtime imports and leaves type-only ones out', () => {
    expect(
      runtimeImports(`import type { A } from './a'
import { type B, type C } from './b'
import { d, type E } from './d'
export { f } from './f'
export type { G } from './g'
import './side-effect'
import x from '../x'
import { h } from './h.ts'`),
    ).toEqual(['./d', './f', './side-effect', '../x', './h.ts'])
  })

  it('resolves a spec with or without .js or .ts, and a folder to its index', () => {
    const from = join(SRC, 'lib', 'diagram', 'geometry.ts')
    const window = join(SRC, 'lib', 'diagram', 'window.ts')
    const index = join(SRC, 'lib', 'util', 'index.ts')
    const known = new Set([window, index])
    for (const spec of ['./window', './window.js', './window.ts']) expect(resolveImport(from, spec, known)).toBe(window)
    expect(resolveImport(from, '../util', known)).toBe(index)
    expect(resolveImport(from, './missing', known)).toBeNull()
  })

  it('resolves every relative import in src, so none can hide a cycle', () => {
    expect(graph().unresolved).toEqual([])
  })

  it('has no runtime import cycle through sequence-diagram.ts or diagram/*', () => {
    expect(cycles(graph().edges, core).map((path) => path.join(' → '))).toEqual([])
  })
})
