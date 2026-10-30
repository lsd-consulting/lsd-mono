// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scenario } from '../../types'
import { bindDiagramScroll, renderDiagramHtml, setFindHooks, syncDiagramWindow } from '../sequence-diagram'
import { setPayloadLoader, setPayloadSlicer } from './payload-find'
import { diagramState, forgetDiagrams } from './state'
import { flushDiagramPaints } from './invalidate'
import { untimed } from '../report-fixture.test-util'
import { DEFAULT_LABEL_MAX_CHARS } from '../../ui/format'

function scenario(withPayloads = true): Scenario {
  return {
    ...untimed(),
    id: 'toolbar',
    title: 'Toolbar',
    status: 'success',
    description: '',
    facts: [],
    metrics: [],
    participants: [
      { id: 'a', name: 'Client', type: 'actor' },
      { id: 'b', name: 'Api', type: 'participant' },
    ],
    events: [
      {
        kind: 'message',
        id: 'm1',
        from: 'a',
        to: 'b',
        label: 'place order',
        type: 'synchronous',
        ...(withPayloads ? { payloadId: 'toolbar/m1' } : {}),
      },
      { kind: 'message', id: 'm2', from: 'b', to: 'a', label: 'snowdrop ok', type: 'synchronous_response' },
    ],
  }
}

function mount(s: Scenario) {
  const host = document.createElement('div')
  host.innerHTML = renderDiagramHtml(s, DEFAULT_LABEL_MAX_CHARS)
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
  // Cancels Find's pending reveal, so it cannot fire after this file's environment is gone (#165).
  forgetDiagrams()
  document.body.innerHTML = ''
  setPayloadSlicer(null)
  setFindHooks({})
})

describe('the Find toolbar and payloads', () => {
  it('cancels the pending reveal after typing when the diagrams are forgotten or the diagram is bound again (#165)', () => {
    vi.useFakeTimers()
    try {
      const { find, host } = mount(scenario(false))
      type(find, 'snowdrop')
      const pending = diagramState.findReveals.get('toolbar')
      expect(pending).toBeDefined()
      const timers = vi.getTimerCount()
      forgetDiagrams()
      expect(diagramState.findReveals.size).toBe(0)
      expect(vi.getTimerCount()).toBe(timers - 1)

      type(find, 'snowdrop')
      const first = diagramState.findReveals.get('toolbar')
      bindDiagramScroll(host)
      expect(diagramState.findReveals.has('toolbar')).toBe(false)
      type(find, 'order')
      const second = diagramState.findReveals.get('toolbar')
      type(find, 'orde')
      // Each keystroke replaces the pending reveal rather than adding one.
      expect(diagramState.findReveals.size).toBe(1)
      expect(new Set([first, second, diagramState.findReveals.get('toolbar')]).size).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

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

describe('the Find magnifier on a narrow toolbar (#123)', () => {
  afterEach(() => {
    forgetDiagrams()
    document.body.innerHTML = ''
  })

  const magnifier = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-find-toggle]')!
  const toolbar = (host: HTMLElement) => host.querySelector<HTMLElement>('.seq-toolbar')!

  it('comes before the field it controls, collapsed, and the toolbar comes before the section links', () => {
    const { host, find } = mount(scenario())
    const button = magnifier(host)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe(find.closest('.diagram-find')!.id)
    expect(button.getAttribute('aria-label')).toBe('Find in diagram')
    expect(button.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toolbar(host).hasAttribute('data-find-open')).toBe(false)
  })

  it('opens Find and focuses the field, and a second press collapses it', () => {
    const { host, find } = mount(scenario())
    const button = magnifier(host)
    button.click()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(toolbar(host).hasAttribute('data-find-open')).toBe(true)
    expect(document.activeElement).toBe(find)
    button.click()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(toolbar(host).hasAttribute('data-find-open')).toBe(false)
  })

  it('collapseFindFrom closes Find to a drawn magnifier, and does nothing when it is not drawn or the field is not Find', async () => {
    const { collapseFindFrom } = await import('./find-binding')
    const { host, find } = mount(scenario())
    const button = magnifier(host)
    button.click()
    // No client rects: a wide toolbar, where the magnifier is not drawn.
    const rects = vi.spyOn(button, 'getClientRects').mockReturnValue([] as unknown as DOMRectList)
    expect(collapseFindFrom(find)).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    rects.mockReturnValue([{}] as unknown as DOMRectList)
    expect(collapseFindFrom(host.querySelector('.seq-scroll')!)).toBeNull()
    expect(collapseFindFrom(find)).toBe(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(toolbar(host).hasAttribute('data-find-open')).toBe(false)
  })
})
