// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scenario } from '../../types'
import { bindDiagramScroll, renderDiagramHtml, setFindHooks, syncDiagramWindow } from '../sequence-diagram'
import { setPayloadLoader, setPayloadSlicer } from './payload-find'
import { forgetDiagrams } from './state'
import { flushDiagramPaints } from './invalidate'

function scenario(withPayloads = true): Scenario {
  return {
    id: 'toolbar',
    title: 'Toolbar',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants: [
      { id: 'a', name: 'Client', type: 'ACTOR' },
      { id: 'b', name: 'Api', type: 'PARTICIPANT' },
    ],
    events: [
      {
        kind: 'message',
        id: 'm1',
        from: 'a',
        to: 'b',
        label: 'place order',
        type: 'SYNCHRONOUS',
        ...(withPayloads ? { payloadId: 'toolbar/m1' } : {}),
      },
      { kind: 'message', id: 'm2', from: 'b', to: 'a', label: 'snowdrop ok', type: 'SYNCHRONOUS_RESPONSE' },
    ],
  }
}

function mount(s: Scenario) {
  const host = document.createElement('div')
  host.innerHTML = renderDiagramHtml(s)
  document.body.append(host)
  const scroll = host.querySelector<HTMLElement>('.seq-scroll')!
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 })
  bindDiagramScroll(host)
  syncDiagramWindow(scroll)
  return {
    find: host.querySelector<HTMLInputElement>('[data-diagram-find]')!,
    toggle: host.querySelector<HTMLButtonElement>('[data-find-payloads]'),
    // Painted once per frame (#104): reading the count paints what is pending.
    count: () => (flushDiagramPaints(), host.querySelector('.diagram-find-count')!.textContent),
    host,
  }
}

const type = (find: HTMLInputElement, value: string) => {
  find.value = value
  find.dispatchEvent(new Event('input', { bubbles: true }))
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  forgetDiagrams()
  setPayloadSlicer({ now: () => 0, later: (resume) => resume(), budgetMs: 8 })
  setPayloadLoader(() => Promise.resolve({ 'toolbar/m1': { voucher: 'SNOWDROP-10' } }))
})
afterEach(() => {
  document.body.innerHTML = ''
  setPayloadSlicer(null)
  setFindHooks({})
})

describe('the Find toolbar and payloads', () => {
  it("names payloads in the field's name and offers the toggle only when there are payloads to search", () => {
    const plain = mount(scenario(false))
    expect(plain.toggle).toBeNull()
    expect(plain.find.getAttribute('aria-label')).toBe('Find messages and notes in this diagram')
    forgetDiagrams()
    document.body.innerHTML = ''
    const rich = mount(scenario())
    expect(rich.toggle!.getAttribute('aria-pressed')).toBe('true')
    expect(rich.toggle!.textContent).toBe('{}Payloads')
    expect(rich.find.getAttribute('aria-label')).toBe('Find messages, notes and payloads in this diagram')
  })

  it('loads payloads when Find gets focus, counts payload matches, and the toggle turns them out and back in', async () => {
    const changed = vi.fn()
    setFindHooks({ changed })
    const { find, toggle, count, host } = mount(scenario())
    find.dispatchEvent(new Event('focus'))
    await settle()
    type(find, 'snowdrop')
    expect(count()).toBe('1 of 2, 1 in payloads')
    expect(host.querySelector('.find-count-payloads')!.textContent).toBe(', 1 in payloads')
    expect(changed).toHaveBeenCalledWith('toolbar')

    toggle!.click()
    expect(toggle!.getAttribute('aria-pressed')).toBe('false')
    expect(find.getAttribute('aria-label')).toBe('Find messages and notes in this diagram')
    expect(count()).toBe('1 of 1')
    toggle!.click()
    expect(count()).toBe('1 of 2, 1 in payloads')
  })

  it('repaints when the answer arrives after the keystroke, making the first match current', async () => {
    const { find, count, host } = mount(scenario())
    type(find, 'snowdrop')
    expect(count()).toBe('1 of 1, searching payloads…')
    await settle()
    expect(count()).toBe('1 of 2, 1 in payloads')
    expect(host.querySelector('.msg-open[data-message-id="m1"]')!.getAttribute('aria-label')).toBe(
      'Open place order, Client to Api, call, has payload, current search match in payload',
    )
  })
})
