import { describe, expect, it } from 'vitest'
import { lowFiles, staleMetrics } from './coverage-ratchet.mjs'

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
