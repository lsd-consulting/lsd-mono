import { describe, expect, it } from 'vitest'
import type { Scenario, Status } from '../types'
import { defaultScenarioId, reselect, stepSelection } from './selection'

const s = (id: string, status: Status = 'success'): Scenario => ({
  id,
  title: id,
  status,
  description: '',
  facts: [],
  metrics: [],
  participants: [],
  events: [],
})

const all = [s('a'), s('b', 'warn'), s('c', 'error'), s('d'), s('e', 'error')]
const pick = (...ids: string[]) => all.filter((item) => ids.includes(item.id))

describe('defaultScenarioId', () => {
  it('picks the first failing scenario, not a warning', () => {
    expect(defaultScenarioId(all)).toBe('c')
  })
  it('falls back to the first scenario, or null when there are none', () => {
    expect(defaultScenarioId([s('x', 'warn'), s('y')])).toBe('x')
    expect(defaultScenarioId([])).toBeNull()
  })
})

describe('reselect', () => {
  it('keeps the current scenario while it still matches', () => {
    expect(reselect(all, pick('b', 'c'), 'c')).toBe('c')
  })
  it('moves to the next match after a filtered-out scenario', () => {
    expect(reselect(all, pick('a', 'd', 'e'), 'c')).toBe('d')
  })
  it('moves back to the nearest match when none comes after it', () => {
    expect(reselect(all, pick('a', 'b'), 'd')).toBe('b')
  })
  it('takes the first match with no or an unknown current scenario', () => {
    expect(reselect(all, pick('b', 'd'), null)).toBe('b')
    expect(reselect(all, pick('b', 'd'), 'gone')).toBe('b')
  })
  it('gives null when nothing matches (the empty state)', () => {
    expect(reselect(all, [], 'a')).toBeNull()
  })
})

describe('stepSelection', () => {
  it('moves through the listed scenarios and stops at the ends', () => {
    const listed = pick('a', 'c', 'e')
    expect(stepSelection(listed, 'a', 1)).toBe('c')
    expect(stepSelection(listed, 'c', -1)).toBe('a')
    expect(stepSelection(listed, 'e', 1)).toBe('e')
    expect(stepSelection(listed, 'a', -1)).toBe('a')
  })
  it('starts from an end when the current one is not listed', () => {
    expect(stepSelection(pick('b', 'd'), 'c', 1)).toBe('b')
    expect(stepSelection(pick('b', 'd'), 'c', -1)).toBe('d')
    expect(stepSelection([], 'c', 1)).toBeNull()
  })
})
