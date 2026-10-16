import { afterEach, describe, expect, it, vi } from 'vitest'
import { STACKED_MAX_PX, isCoarsePointer, isStacked, prefersReducedMotion, scrollBehavior } from './media'

function media(matching: string[]) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: matching.includes(q) }))
}

describe('media', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads reduced motion, the stacked layout and a touch pointer from their media queries', () => {
    media(['(prefers-reduced-motion: reduce)', `(max-width: ${STACKED_MAX_PX}px)`, '(pointer: coarse)'])
    expect([prefersReducedMotion(), isStacked(), isCoarsePointer()]).toEqual([true, true, true])
    expect(scrollBehavior()).toBe('auto')
    media([])
    expect([prefersReducedMotion(), isStacked(), isCoarsePointer()]).toEqual([false, false, false])
    expect(scrollBehavior()).toBe('smooth')
  })

  it('is false everywhere without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect([prefersReducedMotion(), isStacked(), isCoarsePointer()]).toEqual([false, false, false])
  })
})
