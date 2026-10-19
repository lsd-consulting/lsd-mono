import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiagramEvent, Scenario } from '../../types'
import type { Slicer } from '../payload-search'
import { payloadMatches, refreshPayloadFind, setPayloadLoader, setPayloadSlicer } from './payload-find'
import { diagramState, diagramView, forgetDiagrams } from './state'

const events: DiagramEvent[] = [
  { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'place order', type: 'SYNCHRONOUS', payloadId: 's/m1' },
  { kind: 'message', id: 'm2', from: 'b', to: 'c', label: 'reserve', type: 'SYNCHRONOUS', data: { sku: 'SOCK-1' } },
  { kind: 'message', id: 'm3', from: 'c', to: 'b', label: 'ok', type: 'SYNCHRONOUS_RESPONSE' },
  { kind: 'note', id: 'n1', text: 'gift wrap', over: 'b', placement: 'over' },
]
const scenario = { id: 's', events } as unknown as Scenario
const payloads = { 's/m1': { body: { voucher: 'SNOWDROP-10', sku: 'SOCK-19' } } }

/** Everything runs at once unless the test asks for slices; [drain] runs the slices left. */
function slices(budgetMs = 1000): Slicer & { drain: () => void } {
  let t = 0
  const queue: (() => void)[] = []
  return {
    now: () => (t += 1),
    later: (resume) => void queue.push(resume),
    budgetMs,
    drain: () => {
      while (queue.length) queue.shift()!()
    },
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function ids(scenarioId = 's'): string[] {
  return [...payloadMatches(scenarioId).hits].sort()
}

beforeEach(() => {
  forgetDiagrams()
  setPayloadSlicer(slices())
  setPayloadLoader(() => Promise.resolve(payloads))
})
afterEach(() => {
  setPayloadSlicer(null)
  setPayloadLoader(() => Promise.resolve({}))
})

describe('find in payloads', () => {
  it('loads once, then answers each query before the keystroke returns', async () => {
    const loader = vi.fn(() => Promise.resolve(payloads))
    setPayloadLoader(loader)
    const onChange = vi.fn()
    diagramView('s').query = 'sock'
    refreshPayloadFind(scenario, onChange)
    expect(payloadMatches('s')).toMatchObject({ pending: true, failed: false })
    await settle()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(ids()).toEqual(['m1', 'm2'])

    diagramView('s').query = 'SNOWDROP'
    refreshPayloadFind(scenario, onChange)
    expect(ids()).toEqual(['m1'])
    expect(payloadMatches('s').pending).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('searches inline data as well as deferred payloads, and never a label or a message without one', async () => {
    diagramView('s').query = 'sku'
    refreshPayloadFind(scenario, () => {})
    await settle()
    expect(ids()).toEqual(['m1', 'm2'])
    diagramView('s').query = 'gift'
    refreshPayloadFind(scenario, () => {})
    expect(ids()).toEqual([])
    diagramView('s').query = 'place'
    refreshPayloadFind(scenario, () => {})
    expect(ids()).toEqual([])
  })

  it('reports nothing for an empty query, with payloads off, or for a scenario without payloads', async () => {
    const loader = vi.fn(() => Promise.resolve(payloads))
    setPayloadLoader(loader)
    diagramView('s').query = '   '
    refreshPayloadFind(scenario, () => {})
    await settle()
    expect(payloadMatches('s')).toMatchObject({ pending: false, failed: false })
    expect(ids()).toEqual([])

    diagramView('s').query = 'sock'
    diagramView('s').includePayloads = false
    expect(payloadMatches('s')).toMatchObject({ pending: false })
    expect(ids()).toEqual([])

    const bare = { id: 'bare', events: [events[2]] } as unknown as Scenario
    diagramView('bare').query = 'ok'
    refreshPayloadFind(bare, () => {})
    expect(diagramState.payloadFind.has('bare')).toBe(false)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('runs a long search in slices, and a newer query stops the older one', async () => {
    const slicer = slices(2)
    setPayloadSlicer(slicer)
    const onChange = vi.fn()
    refreshPayloadFind(scenario, onChange)
    await settle()
    slicer.drain()
    onChange.mockClear()

    diagramView('s').query = 'sock'
    refreshPayloadFind(scenario, onChange)
    expect(payloadMatches('s').pending).toBe(true)
    diagramView('s').query = 'snowdrop'
    refreshPayloadFind(scenario, onChange)
    slicer.drain()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(payloadMatches('s').pending).toBe(false)
    expect(ids()).toEqual(['m1'])
  })

  it('says when payloads could not be loaded, and tries again next time', async () => {
    const loader = vi.fn((): Promise<Record<string, unknown>> => Promise.reject(new Error('gone')))
    setPayloadLoader(loader)
    const onChange = vi.fn()
    diagramView('s').query = 'sock'
    refreshPayloadFind(scenario, onChange)
    await settle()
    expect(payloadMatches('s')).toMatchObject({ failed: true, pending: false })
    expect(onChange).toHaveBeenCalledTimes(1)

    loader.mockImplementation(() => Promise.resolve(payloads))
    refreshPayloadFind(scenario, onChange)
    await settle()
    expect(ids()).toEqual(['m1', 'm2'])
  })

  it('drops a load that finishes after the report was replaced', async () => {
    let resolve: (map: Record<string, unknown>) => void = () => {}
    setPayloadLoader(() => new Promise((done) => (resolve = done)))
    const onChange = vi.fn()
    diagramView('s').query = 'sock'
    refreshPayloadFind(scenario, onChange)
    forgetDiagrams()
    resolve(payloads)
    await settle()
    expect(onChange).not.toHaveBeenCalled()
    expect(diagramState.payloadFind.size).toBe(0)
  })
})
