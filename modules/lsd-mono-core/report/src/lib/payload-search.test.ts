import { describe, expect, it } from 'vitest'
import {
  COUNT_LIMIT,
  type PayloadEntry,
  type Slicer,
  foldCase,
  foldQuery,
  indexPayloads,
  matchOffsets,
  payloadText,
  runSliced,
  searchPayloads,
} from './payload-search'

/** A clock that moves [step] ms on every look, and a queue for the slices that come back later. */
function fakeSlicer(step: number, budgetMs = 8): Slicer & { queue: (() => void)[]; drain: () => number } {
  let t = 0
  const queue: (() => void)[] = []
  return {
    now: () => (t += step),
    later: (resume) => void queue.push(resume),
    budgetMs,
    queue,
    drain() {
      let slices = 0
      while (queue.length) {
        slices++
        queue.shift()!()
      }
      return slices
    },
  }
}

function entries(values: Record<string, unknown>): PayloadEntry[] {
  const into: PayloadEntry[] = []
  const work = indexPayloads(
    Object.entries(values).map(([id, value]) => ({ id, value })),
    into,
  )
  while (!work.next().done) {
    /* index everything */
  }
  return into
}

function search(list: PayloadEntry[], query: string, within: ReadonlySet<string> | null = null): string[] {
  const hits = new Set<string>()
  const work = searchPayloads(list, foldQuery(query), hits, within)
  while (!work.next().done) {
    /* search everything */
  }
  return [...hits]
}

describe('the text a payload is searched as', () => {
  it('is what the side panel shows: indented JSON, or a string as it is', () => {
    expect(payloadText({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(payloadText('plain body')).toBe('plain body')
    expect(payloadText('{"a":1}')).toBe('{"a":1}')
  })

  it('folds case one unit for one, so offsets stay put', () => {
    expect(foldCase('Order ABC')).toBe('order abc')
    const text = 'İstanbul ORDER'
    const folded = foldCase(text)
    expect(folded.length).toBe(text.length)
    expect(folded.indexOf('order')).toBe(text.indexOf('ORDER'))
    expect(foldCase('STRASSE ß')).toBe('strasse ß')
  })

  it('trims and folds the query', () => {
    expect(foldQuery('  Ord_1 ')).toBe('ord_1')
    expect(foldQuery('   ')).toBe('')
  })
})

describe('searching payloads', () => {
  const list = entries({
    m1: { method: 'POST', headers: { 'X-Request-Id': 'REQ-1' }, body: { qty: 2, sku: 'SOCK-19' } },
    m2: { body: { sku: 'SOCK-1', note: 'gift' } },
    m3: 'raw text with Gift card',
    m4: undefined,
    m5: null,
  })

  it('leaves out messages with nothing to show', () => {
    expect(list.map((e) => e.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('matches keys and values, case-insensitively, as shown', () => {
    expect(search(list, 'x-request-id')).toEqual(['m1'])
    expect(search(list, 'req-1')).toEqual(['m1'])
    expect(search(list, '"qty": 2')).toEqual(['m1'])
    expect(search(list, 'GIFT')).toEqual(['m2', 'm3'])
    expect(search(list, 'sock-1')).toEqual(['m1', 'm2'])
    expect(search(list, 'nowhere')).toEqual([])
  })

  it('treats the query as text, not a pattern', () => {
    const special = entries({ a: { path: '/a.b*c?(d)' }, b: { path: '/axbbc' } })
    expect(search(special, '.b*c?(')).toEqual(['a'])
  })

  it('narrows a longer query to what the shorter one matched', () => {
    const first = new Set(search(list, 'sock-1'))
    expect(search(list, 'sock-19', first)).toEqual(['m1'])
    expect(search(list, 'gift', new Set(['m3']))).toEqual(['m3'])
  })
})

describe('match offsets', () => {
  it('finds every match, without overlaps, and caps what it keeps', () => {
    expect(matchOffsets('abab ab', 'ab')).toEqual({ offsets: [0, 2, 5], total: 3 })
    expect(matchOffsets('aaaa', 'aa')).toEqual({ offsets: [0, 2], total: 2 })
    expect(matchOffsets('abab ab', 'ab', 2)).toEqual({ offsets: [0, 2], total: 3 })
    expect(matchOffsets('abc', '')).toEqual({ offsets: [], total: 0 })
  })

  it('stops counting at the count limit', () => {
    const { offsets, total } = matchOffsets('a'.repeat(COUNT_LIMIT + 50), 'a', 5)
    expect(offsets).toHaveLength(5)
    expect(total).toBe(COUNT_LIMIT)
  })
})

describe('sliced work', () => {
  function counter(steps: number) {
    let done = 0
    const work = (function* () {
      for (let i = 0; i < steps; i++) {
        done++
        yield
      }
    })()
    return { work, done: () => done }
  }

  it('finishes in the same call when it fits in one slice', () => {
    const slicer = fakeSlicer(1, 100)
    const { work, done } = counter(10)
    let finished = false
    expect(
      runSliced(
        work,
        slicer,
        () => false,
        () => (finished = true),
      ),
    ).toBe(true)
    expect(finished).toBe(true)
    expect(done()).toBe(10)
    expect(slicer.queue).toHaveLength(0)
  })

  it('gives the page back when a slice runs out of time, then carries on', () => {
    const slicer = fakeSlicer(1, 8)
    const { work, done } = counter(40)
    let finished = false
    expect(
      runSliced(
        work,
        slicer,
        () => false,
        () => (finished = true),
      ),
    ).toBe(false)
    expect(finished).toBe(false)
    expect(done()).toBeLessThan(40)
    expect(slicer.drain()).toBeGreaterThan(1)
    expect(finished).toBe(true)
    expect(done()).toBe(40)
  })

  it('stops, without finishing, once cancelled', () => {
    const slicer = fakeSlicer(1, 8)
    const { work, done } = counter(40)
    let cancel = false
    let finished = false
    runSliced(
      work,
      slicer,
      () => cancel,
      () => (finished = true),
    )
    const before = done()
    cancel = true
    slicer.drain()
    expect(done()).toBe(before)
    expect(finished).toBe(false)
  })
})
