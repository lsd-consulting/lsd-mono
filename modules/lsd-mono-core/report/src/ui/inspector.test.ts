// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { MessageEvent, MessageType, Report } from '../types'
import { sampleReport } from '../data/sample-report'
import { shellParts } from '../lib/payloads'
import { componentGraph } from '../lib/component-graph'
import { bindComponentScroll, bindInspector, delegateMessageOpen, inspectorMarkup } from './inspector'
import {
  INSPECTOR_MIN_PX,
  INSPECTOR_NARROW_PX,
  INSPECTOR_WIDTH_KEY,
  clampInspectorWidth,
  inspectorWidthLimits,
} from './inspector-width'
import { createKeyRouter } from '../lib/keys/router'
import type { InspectorController } from './inspector'
/** Escape as the page's key router gives it to the side panel (#102). */
function pressEscape(controller: InspectorController): void {
  const router = createKeyRouter(() => ({
    dialog: null,
    panel: { open: controller.isOpen() },
    diagram: null,
    page: null,
  }))
  router.on('panel', 'close-panel', () => controller.close())
  router.dispatch(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

const bodyMarker = 'arrow-payload-SOCK'

function fullReport(): Report {
  return {
    title: 'perf',
    generatedAt: '2026-10-03T12:00:00Z',
    generator: 'test',
    scenarios: [
      {
        id: 's',
        title: 'Large',
        status: 'success',
        description: '',
        facts: [],
        metrics: [],
        participants: [],
        events: [
          {
            kind: 'message',
            id: '1',
            from: 'client',
            to: 'api',
            label: 'place order',
            type: 'SYNCHRONOUS',
            data: {
              method: 'POST',
              path: '/v1/orders/1',
              status: 202,
              body: { marker: bodyMarker, orderId: 'ord_1' },
            },
          },
        ],
      },
    ],
  }
}

function message(): MessageEvent {
  const parts = shellParts(fullReport(), 'payloads.js')
  const event = parts.report.scenarios[0].events[0]
  if (event.kind !== 'message') throw new Error('expected a message')
  return event
}

describe('payloads stay out of the initial report', () => {
  it('keeps demo bodies out of the sample report module', async () => {
    const json = JSON.stringify(sampleReport)
    expect(json).not.toContain('pm_visa')
    expect(json).toContain('/checkout')
    const { samplePayloads } = await import('../data/sample-payloads')
    expect(JSON.stringify(samplePayloads)).toContain('pm_visa')
  })

  it('puts the json body in the sidecar, and keeps method, path, and status on the message', () => {
    const parts = shellParts(fullReport(), 'mono-payloads.js')
    expect(parts.htmlScript).not.toContain(bodyMarker)
    expect(parts.htmlScript).not.toContain('ord_1')
    expect(parts.htmlScript).toContain('POST')
    expect(parts.htmlScript).toContain('/v1/orders/1')
    expect(parts.htmlScript).toContain('202')
    expect(parts.htmlScript).toContain('window.__LSD_PAYLOADS_SRC__="mono-payloads.js"')
    expect(parts.payloadsJs).toContain(bodyMarker)
    expect(JSON.stringify(parts.report)).not.toContain(bodyMarker)
  })
})

describe('inspector', () => {
  let opened: MessageEvent

  beforeEach(() => {
    opened = message()
    sessionStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    document.body.innerHTML = `
      <div class="shell" id="shell">
        <button type="button" id="other">Still here</button>
        <button type="button" class="msg-open" data-message-id="1">arrow</button>
        ${inspectorMarkup()}
      </div>`
  })

  function mount() {
    const parts = shellParts(fullReport(), 'payloads.js')
    const controller = bindInspector(document, {
      loadPayload: async (scenarioId, messageId) => parts.payloads[`${scenarioId}/${messageId}`],
      onClose: (invoker) => {
        if (!invoker) return
        document.querySelector<HTMLButtonElement>(`button.msg-open[data-message-id="${invoker.messageId}"]`)?.focus()
      },
    })
    const shell = document.querySelector<HTMLElement>('#shell')!
    const open = (scenarioId: string, message: MessageEvent) => controller.openMessage(scenarioId, message)
    const lookup = () => ({ scenarioId: 's', message: opened })
    shell.addEventListener('click', (event) => delegateMessageOpen(event, lookup, open))
    shell.addEventListener('keydown', (event) => delegateMessageOpen(event, lookup, open))
    return controller
  }

  function panel() {
    return document.querySelector<HTMLElement>('#inspector')!
  }

  async function settle() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  it("lists a link's interactions in the panel when the link is clicked or pressed", () => {
    const controller = bindInspector(document, { loadPayload: async () => ({}), onClose: () => {} })
    const call = (id: string, to: string, label: string, type: MessageType = 'SYNCHRONOUS') => ({
      kind: 'message' as const,
      id,
      from: 'a',
      to,
      label,
      type,
    })
    const graph = componentGraph({
      participants: [
        { id: 'a', name: 'Orders', type: 'PARTICIPANT' },
        { id: 'b', name: 'Orders <DB>', type: 'DATABASE' },
        { id: 'c', name: 'Events', type: 'QUEUE' },
      ],
      events: [
        call('1', 'b', 'load basket'),
        call('2', 'b', 'reserve stock'),
        call('3', 'b', 'load basket'),
        call('4', 'c', 'order.paid', 'ASYNCHRONOUS'),
      ],
    })
    controller.openComponents('s', graph, 'Links')
    const host = document.querySelector<HTMLElement>('#inspector-graph')!
    const list = host.querySelector<HTMLElement>('.component-links')!
    expect(list.textContent).toContain('click it to list them here')
    const links = host.querySelectorAll<SVGGElement>('.edge-group')
    expect(links).toHaveLength(2)

    links[0].querySelector('.edge-hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(list.querySelector('h3')!.textContent).toBe('Orders → Orders <DB> (3 interactions)')
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'load basket · sync ×2',
      'reserve stock · sync',
    ])
    expect(links[0].classList.contains('is-selected')).toBe(true)

    links[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(list.querySelector('h3')!.textContent).toBe('Orders → Events (1 interaction)')
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['order.paid · async'])
    expect(links[0].classList.contains('is-selected')).toBe(false)
    expect(links[1].classList.contains('is-selected')).toBe(true)
  })

  it('shows a component diagram in the same panel, then a message restores the json chrome', async () => {
    const closed: Array<string | undefined> = []
    const controller = bindInspector(document, {
      loadPayload: async () => ({ ok: true }),
      onClose: (invoker) => closed.push(invoker?.kind),
    })
    const graph = componentGraph({
      participants: [
        { id: 'a', name: 'Alpha', type: 'ACTOR' },
        { id: 'b', name: 'Beta', type: 'PARTICIPANT' },
        { id: 'c', name: 'Gamma', type: 'DATABASE' },
        { id: 'd', name: 'Delta', type: 'QUEUE' },
        { id: 'e', name: 'Epsilon', type: 'PARTICIPANT' },
      ],
      events: ['b', 'c', 'd', 'e'].map((to, i) => ({
        kind: 'message' as const,
        id: String(i),
        from: i === 0 ? 'a' : 'b',
        to: i === 0 ? 'b' : to,
        label: `call ${to}`,
        type: 'SYNCHRONOUS' as const,
      })),
    })
    controller.openComponents('s', graph, 'Wide scenario')
    const host = document.querySelector<HTMLElement>('#inspector-graph')!
    expect(panel().hidden).toBe(false)
    expect(document.querySelector('#inspector-title')!.textContent).toBe('Component diagram')
    expect(document.querySelector('#inspector-meta')!.textContent).toContain('5 components')
    expect(document.querySelector('#inspector-meta')!.textContent).toContain('4 links')
    expect(host.hidden).toBe(false)
    expect(host.querySelector('svg.component-diagram')).not.toBeNull()
    expect(host.querySelectorAll('.component-node')).toHaveLength(5)
    expect(document.querySelector<HTMLElement>('.json-row')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#inspector-copy')!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#inspector-pre')!.hidden).toBe(true)
    // Three callees side by side need more than the narrow column; the saved width stays put.
    const widened = Number.parseInt(
      document.querySelector<HTMLElement>('#shell')!.style.getPropertyValue('--inspector-w'),
    )
    expect(widened).toBeGreaterThan(INSPECTOR_NARROW_PX)
    expect(sessionStorage.getItem(INSPECTOR_WIDTH_KEY)).toBeNull()

    controller.openMessage('s', message())
    expect(host.hidden).toBe(true)
    expect(host.childElementCount).toBe(0)
    expect(document.querySelector<HTMLElement>('.json-row')!.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('#inspector-copy')!.hidden).toBe(false)
    expect(document.querySelector('#shell')!.getAttribute('style')).toContain(`${INSPECTOR_NARROW_PX}px`)

    controller.openComponents('s', graph, 'Wide scenario')
    controller.close()
    expect(closed).toEqual(['components'])
  })

  it('opens from a click into a non-modal panel and shows json after the payload loads', async () => {
    mount()
    const other = document.querySelector<HTMLButtonElement>('#other')!
    document.querySelector<HTMLButtonElement>('button.msg-open')!.click()
    expect(panel().hidden).toBe(false)
    expect(panel().getAttribute('aria-modal')).toBeNull()
    expect(panel().getAttribute('aria-labelledby')).toBe('inspector-title')
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.body.hasAttribute('inert')).toBe(false)
    expect(other.inert).toBe(false)
    expect(document.body.innerHTML).not.toContain('aria-modal')
    const meta = document.querySelector('#inspector-meta')!.textContent ?? ''
    expect(meta).toContain('POST')
    expect(meta).toContain('/v1/orders/1')
    expect(meta).toContain('202')
    const pre = document.querySelector<HTMLElement>('#inspector-pre')!
    const toggle = document.querySelector<HTMLButtonElement>('#inspector-json')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('Show JSON')
    expect(pre.hidden).toBe(true)
    expect(pre.textContent).not.toContain(bodyMarker)
    expect(document.querySelector('#inspector-copy')!.textContent).toContain('Copy')
    await settle()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toContain('Hide JSON')
    expect(pre.hidden).toBe(false)
    expect(pre.textContent).toContain(bodyMarker)
    expect(pre.textContent).toContain('ord_1')
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain('Show JSON')
    expect(pre.hidden).toBe(true)
  })

  it("marks Find's matches in the JSON, steps through them, and clears them when the query does", async () => {
    let query = 'sock'
    const parts = shellParts(fullReport(), 'payloads.js')
    const controller = bindInspector(document, {
      loadPayload: async (scenarioId, messageId) => parts.payloads[`${scenarioId}/${messageId}`],
      onClose: () => {},
      findQuery: () => query,
    })
    const other = document.querySelector<HTMLButtonElement>('#other')!
    other.focus()
    controller.openMessage('s', opened, { focus: false })
    expect(document.activeElement).toBe(other)
    await settle()
    const pre = document.querySelector<HTMLElement>('#inspector-pre')!
    const box = document.querySelector<HTMLElement>('#inspector-find')!
    const count = box.querySelector('.json-find-count')!
    expect(box.hidden).toBe(false)
    expect(count.getAttribute('aria-live')).toBe('polite')
    expect(pre.querySelectorAll('mark.json-hit')).toHaveLength(1)
    expect(pre.querySelector('mark.is-current')!.textContent).toBe('SOCK')
    expect(pre.querySelector('mark.is-current')!.getAttribute('aria-current')).toBe('true')
    expect(count.textContent).toBe('1 of 1 in payload')
    expect(controller.printView()!.text).toBe(pre.textContent)
    expect(pre.textContent).not.toContain('<mark')

    query = '"'
    controller.refreshFind()
    const marks = pre.querySelectorAll('mark.json-hit')
    expect(marks.length).toBeGreaterThan(4)
    expect(count.textContent).toBe(`1 of ${marks.length} in payload`)
    box.querySelector<HTMLButtonElement>('[data-json-step="prev"]')!.click()
    expect(count.textContent).toBe(`${marks.length} of ${marks.length} in payload`)
    box.querySelector<HTMLButtonElement>('[data-json-step="next"]')!.click()
    expect(count.textContent).toBe(`1 of ${marks.length} in payload`)
    expect(pre.querySelectorAll('mark.is-current')).toHaveLength(1)

    query = ''
    controller.refreshFind()
    expect(pre.querySelectorAll('mark')).toHaveLength(0)
    expect(box.hidden).toBe(true)
    expect(pre.textContent).toContain(bodyMarker)
  })

  it('widens the json column without becoming a modal, and copy still takes the full payload', async () => {
    const controller = mount()
    const arrow = document.querySelector<HTMLButtonElement>('button.msg-open')!
    arrow.focus()
    arrow.click()
    const widen = document.querySelector<HTMLButtonElement>('#inspector-json-expand')!
    const shell = document.querySelector<HTMLElement>('#shell')!
    expect(widen.hidden).toBe(false)
    expect(widen.getAttribute('aria-pressed')).toBe('false')
    expect(shell.classList.contains('inspector-json-wide')).toBe(false)
    expect(shell.style.getPropertyValue('--inspector-w')).toBe(`${INSPECTOR_NARROW_PX}px`)
    await settle()
    expect(panel().getAttribute('aria-modal')).toBeNull()
    widen.click()
    const expanded = inspectorWidthLimits(window.innerWidth).expand
    expect(widen.getAttribute('aria-pressed')).toBe('true')
    expect(widen.textContent).toBe('Shrink')
    expect(widen.getAttribute('aria-label')).toBe('Shrink JSON')
    expect(shell.classList.contains('inspector-json-wide')).toBe(true)
    expect(panel().classList.contains('inspector-json-wide')).toBe(true)
    expect(shell.style.getPropertyValue('--inspector-w')).toBe(`${expanded}px`)
    expect(sessionStorage.getItem(INSPECTOR_WIDTH_KEY)).toBe(String(expanded))
    const pre = document.querySelector<HTMLElement>('#inspector-pre')!
    expect(pre.hidden).toBe(false)
    expect(pre.textContent).toContain(bodyMarker)
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied = value
        },
      },
    })
    document.querySelector<HTMLButtonElement>('#inspector-copy')!.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(copied).toContain(bodyMarker)
    expect(copied).toContain('ord_1')
    document.querySelector<HTMLButtonElement>('#inspector-json')!.click()
    expect(document.querySelector<HTMLElement>('#inspector-pre')!.hidden).toBe(true)
    expect(widen.hidden).toBe(false)
    expect(shell.classList.contains('inspector-json-wide')).toBe(true)
    widen.click()
    expect(widen.textContent).toBe('Expand')
    expect(shell.style.getPropertyValue('--inspector-w')).toBe(`${INSPECTOR_NARROW_PX}px`)
    pressEscape(controller)
    expect(panel().hidden).toBe(true)
    expect(document.activeElement).toBe(arrow)
  })

  it('opens from Enter and Escape returns focus to that arrow', async () => {
    const controller = mount()
    const arrow = document.querySelector<HTMLButtonElement>('button.msg-open')!
    arrow.focus()
    arrow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(panel().hidden).toBe(false)
    expect(document.activeElement).toBe(panel())
    expect(panel().getAttribute('aria-modal')).toBeNull()
    pressEscape(controller)
    expect(panel().hidden).toBe(true)
    expect(document.activeElement).toBe(arrow)
  })

  it('drags the inner edge and keeps that width for the session', () => {
    const controller = mount()
    document.querySelector<HTMLButtonElement>('button.msg-open')!.click()
    const handle = document.querySelector<HTMLElement>('#inspector-resize')!
    const shell = document.querySelector<HTMLElement>('#shell')!
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 800, bubbles: true, button: 0 }))
    expect(shell.classList.contains('inspector-resizing')).toBe(true)
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, bubbles: true }))
    const dragged = clampInspectorWidth(INSPECTOR_NARROW_PX + 300, window.innerWidth)
    expect(shell.style.getPropertyValue('--inspector-w')).toBe(`${dragged}px`)
    expect(handle.getAttribute('aria-valuenow')).toBe(String(dragged))
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 500, bubbles: true }))
    expect(shell.classList.contains('inspector-resizing')).toBe(false)
    expect(sessionStorage.getItem(INSPECTOR_WIDTH_KEY)).toBe(String(dragged))

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true, button: 0 }))
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 4000, bubbles: true }))
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    expect(shell.style.getPropertyValue('--inspector-w')).toBe(`${INSPECTOR_MIN_PX}px`)

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(shell.style.getPropertyValue('--inspector-w')).toBe(`${inspectorWidthLimits(window.innerWidth).max}px`)
    expect(Number(shell.style.getPropertyValue('--inspector-w').replace('px', ''))).toBeLessThanOrEqual(
      window.innerWidth * 0.9,
    )

    pressEscape(controller)
    document.querySelector<HTMLButtonElement>('button.msg-open')!.click()
    expect(shell.style.getPropertyValue('--inspector-w')).toBe(`${inspectorWidthLimits(window.innerWidth).max}px`)
  })
})

describe('bindComponentScroll', () => {
  it('marks the component drawing while part of it lies past the right edge', () => {
    const scroller = document.createElement('div')
    const size = (scrollLeft: number, clientWidth: number, scrollWidth: number) => {
      Object.defineProperty(scroller, 'clientWidth', { value: clientWidth, configurable: true })
      Object.defineProperty(scroller, 'scrollWidth', { value: scrollWidth, configurable: true })
      scroller.scrollLeft = scrollLeft
    }
    size(0, 358, 516)
    bindComponentScroll(scroller)
    expect(scroller.hasAttribute('data-more-right')).toBe(true)
    expect(scroller.hasAttribute('data-more-left')).toBe(false)
    size(158, 358, 516)
    scroller.dispatchEvent(new Event('scroll'))
    expect(scroller.hasAttribute('data-more-right')).toBe(false)
    expect(scroller.hasAttribute('data-more-left')).toBe(true)
    expect(scroller.getAttribute('tabindex')).toBe('0')
    expect(scroller.getAttribute('role')).toBe('region')
    bindComponentScroll(null)
  })

  it('leaves a drawing that fits unmarked', () => {
    const scroller = document.createElement('div')
    Object.defineProperty(scroller, 'clientWidth', { value: 523 })
    Object.defineProperty(scroller, 'scrollWidth', { value: 523 })
    bindComponentScroll(scroller)
    expect(scroller.hasAttribute('data-more-right')).toBe(false)
    expect(scroller.hasAttribute('data-more-left')).toBe(false)
    expect(scroller.hasAttribute('tabindex')).toBe(false)
    expect(scroller.hasAttribute('role')).toBe(false)
  })

  it('binds its listeners once, however often the same drawing is bound', () => {
    const scroller = document.createElement('div')
    const link = scroller.appendChild(document.createElement('a'))
    let scrolled = 0
    link.scrollIntoView = () => {
      scrolled++
    }
    bindComponentScroll(scroller)
    bindComponentScroll(scroller)
    link.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(scrolled).toBe(1)
    bindComponentScroll(null)
  })

  it('re-marks the edges when the box is resized, as on a rotate', () => {
    const observed: ResizeObserverCallback[] = []
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observed.push(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    try {
      const scroller = document.createElement('div')
      Object.defineProperty(scroller, 'scrollWidth', { value: 516, configurable: true })
      Object.defineProperty(scroller, 'clientWidth', { value: 516, configurable: true })
      bindComponentScroll(scroller)
      expect(scroller.hasAttribute('data-more-right')).toBe(false)
      Object.defineProperty(scroller, 'clientWidth', { value: 358, configurable: true })
      observed[0]([], {} as ResizeObserver)
      expect(scroller.hasAttribute('data-more-right')).toBe(true)
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})
