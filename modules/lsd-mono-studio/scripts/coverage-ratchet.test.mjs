import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { lowFiles, staleMetrics } from './coverage-ratchet-lib.mjs'

const metrics = (statements, branches, functions, lines) => ({
  statements: { pct: statements },
  branches: { pct: branches },
  functions: { pct: functions },
  lines: { pct: lines },
})
const floors = { statements: 97, branches: 93, functions: 96, lines: 97 }

describe('coverage ratchet', () => {
  it('passes while every metric is at most 3 points above its threshold', () => {
    expect(staleMetrics(metrics(100, 96, 99, 100), floors)).toEqual([])
    expect(staleMetrics(metrics(97, 93, 96, 97), floors)).toEqual([])
  })

  it('names each metric more than 3 points above its threshold, and says to raise it', () => {
    expect(staleMetrics(metrics(97, 96.01, 96, 97), floors)).toEqual([
      'coverage ratchet: branches is 96.01%, more than 3 points above its threshold 93; raise it in vitest.config.ts',
    ])
    expect(staleMetrics(metrics(100, 96.5, 99.5, 100), { ...floors, functions: 90 })).toHaveLength(2)
  })

  it('does not hold a metric without a threshold', () => {
    expect(staleMetrics(metrics(100, 100, 100, 100), { lines: 97 })).toEqual([])
  })

  it('takes the margin it is given', () => {
    expect(staleMetrics(metrics(98, 93, 96, 97), floors, 0.5)).toHaveLength(1)
  })

  it('lists files under the line limit, but not the total or files without lines', () => {
    const file = (pct, total = 10) => ({ lines: { pct, total } })
    const summary = { total: file(10), '/s/a.ts': file(49.9), '/s/b.ts': file(50), '/s/types.ts': file(0, 0) }
    expect(lowFiles(summary).map(([name]) => name)).toEqual(['/s/a.ts'])
  })
})

describe('coverage ratchet script', () => {
  const made = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A package with the ratchet scripts, [thresholds] and a summary at [pct] for every metric. */
  function fakePackage(thresholds, pct) {
    const dir = mkdtempSync(join(tmpdir(), 'studio-ratchet-'))
    made.push(dir)
    const pkg = join(dir, 'pkg')
    mkdirSync(join(pkg, 'scripts'), { recursive: true })
    mkdirSync(join(pkg, 'coverage'))
    for (const name of ['coverage-ratchet.mjs', 'coverage-ratchet-lib.mjs'])
      copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(pkg, 'scripts', name))
    writeFileSync(
      join(pkg, 'vitest.config.ts'),
      `export default { test: { coverage: { thresholds: ${JSON.stringify(thresholds)} } } }\n`,
    )
    const m = { total: 10, covered: 10, skipped: 0, pct }
    const total = { statements: m, branches: m, functions: m, lines: m }
    writeFileSync(join(pkg, 'coverage', 'coverage-summary.json'), JSON.stringify({ total }))
    // A symlink to the package: Node runs the realpath, while process.argv[1] keeps the link.
    const link = join(dir, 'link')
    symlinkSync(pkg, link, process.platform === 'win32' ? 'junction' : 'dir')
    return { pkg, link }
  }

  function run(script) {
    return spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', script], { encoding: 'utf8' })
  }

  it('fails a stale threshold however it is started, through a symlinked path too', () => {
    const { pkg, link } = fakePackage({ statements: 90, branches: 90, functions: 90, lines: 90 }, 99)
    for (const script of [
      join(pkg, 'scripts', 'coverage-ratchet.mjs'),
      join(link, 'scripts', 'coverage-ratchet.mjs'),
    ]) {
      const result = run(script)
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('coverage ratchet: statements is 99%, more than 3 points above its threshold 90')
    }
  })

  it('passes thresholds within 3 points', () => {
    const { link } = fakePackage({ statements: 97, branches: 97, functions: 97, lines: 97 }, 99)
    const result = run(join(link, 'scripts', 'coverage-ratchet.mjs'))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
  })
})
