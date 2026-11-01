import { describe, expect, it } from 'vitest'
import { callShares } from './timing.ts'

describe('callShares', () => {
  it('is empty without calls', () => {
    expect(callShares([])).toEqual({})
    expect(callShares([{ id: 'a', type: 'asynchronous', durationMs: 3 }])).toEqual({})
  })

  it('counts calls with a duration and calls a reply names', () => {
    expect(
      callShares([
        { id: 'c1', type: 'synchronous', durationMs: 4 },
        { id: 'c2', type: 'synchronous' },
        { id: 'c3', type: 'synchronous', durationMs: 0 },
        { id: 'c4', type: 'synchronous' },
        { id: 'r1', type: 'synchronous_response', replyTo: 'c1' },
        { id: 'r2', type: 'synchronous_response', replyTo: 'c2' },
        { id: 'r3', type: 'synchronous_response', replyTo: 'elsewhere' },
      ]),
    ).toEqual({ measuredRatio: 0.5, pairedRatio: 0.5 })
  })
})
