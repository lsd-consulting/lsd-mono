import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MessageEvent, Report, Scenario } from '../types'
import { timeline } from './timing'

// Written by the library (TimingTreeGoldenTest): the Timing view must follow its tree.
const report = JSON.parse(
  readFileSync(join(process.cwd(), '../src/test/resources/golden/timing-tree.json'), 'utf8'),
) as Report
const scenario = (title: string): Scenario => report.scenarios.find((s) => s.title === title)!
const rows = (s: Scenario) => timeline(s).rows
const row = (s: Scenario, label: string) => rows(s).find((r) => r.message.label === label)!

describe('timeline follows the library tree', () => {
  it('nests by parentSpanId: the child is under A, not under B', () => {
    const s = scenario('span nesting')
    expect(row(s, 'child of A').depth).toBe(row(s, 'A').depth + 1)
    expect(row(s, 'B').overrun).toBe(false)
    expect(row(s, 'A').childMs).toBe(150)
  })

  it('pairs duplicate spans as the library did: second inside first', () => {
    const s = scenario('duplicate span')
    expect(row(s, 'second').depth).toBe(row(s, 'first').depth + 1)
    expect(s.warnings?.[0]).toMatch(/^duplicate span/)
  })

  it('keeps the library order for the ALL_SOURCES per-source fallback', () => {
    const s = scenario('all sources fallback')
    const order = s.events.filter((e): e is MessageEvent => e.kind === 'message').map((e) => e.label)
    expect(order).toEqual(['publish', 'late', 'consume', 'other'])
    expect(rows(s).map((r) => r.message.label)).toEqual(order)
  })

  it('every row depth matches the parentId chain in the JSON', () => {
    for (const s of report.scenarios) {
      const byId = new Map(s.events.filter((e): e is MessageEvent => e.kind === 'message').map((e) => [e.id, e]))
      const depth = (m: MessageEvent): number => (m.parentId ? depth(byId.get(m.parentId)!) + 1 : 0)
      for (const r of rows(s)) expect(r.depth, `${s.title}: ${r.message.label}`).toBe(depth(r.message))
    }
  })
})
