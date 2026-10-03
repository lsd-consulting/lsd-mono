// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { MessageEvent, Report } from '../types'
import { sampleReport } from '../data/sample-report'
import { shellParts } from '../lib/payloads'
import { bindInspector, delegateMessageOpen, inspectorMarkup } from './inspector'

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

  async function expand() {
    document.querySelector<HTMLButtonElement>('#inspector-json')!.click()
    await Promise.resolve()
    await Promise.resolve()
  }

  it('opens from a click into a non-modal panel with the json collapsed', async () => {
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
    await expand()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(pre.hidden).toBe(false)
    expect(pre.textContent).toContain(bodyMarker)
    expect(pre.textContent).toContain('ord_1')
  })

  it('widens the json column without becoming a modal, and copy still takes the full payload', async () => {
    mount()
    const arrow = document.querySelector<HTMLButtonElement>('button.msg-open')!
    arrow.focus()
    arrow.click()
    const widen = document.querySelector<HTMLButtonElement>('#inspector-json-expand')!
    const shell = document.querySelector<HTMLElement>('#shell')!
    expect(widen.hidden).toBe(true)
    expect(widen.getAttribute('aria-pressed')).toBe('false')
    expect(shell.classList.contains('inspector-json-wide')).toBe(false)
    await expand()
    expect(widen.hidden).toBe(false)
    expect(panel().getAttribute('aria-modal')).toBeNull()
    widen.click()
    expect(widen.getAttribute('aria-pressed')).toBe('true')
    expect(widen.textContent).toBe('Shrink')
    expect(widen.getAttribute('aria-label')).toBe('Shrink JSON')
    expect(shell.classList.contains('inspector-json-wide')).toBe(true)
    expect(panel().classList.contains('inspector-json-wide')).toBe(true)
    const pre = document.querySelector<HTMLElement>('#inspector-pre')!
    expect(pre.hidden).toBe(false)
    expect(pre.textContent).toContain(bodyMarker)
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value } },
    })
    document.querySelector<HTMLButtonElement>('#inspector-copy')!.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(copied).toContain(bodyMarker)
    expect(copied).toContain('ord_1')
    document.querySelector<HTMLButtonElement>('#inspector-json')!.click()
    expect(widen.hidden).toBe(true)
    expect(shell.classList.contains('inspector-json-wide')).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(panel().hidden).toBe(true)
    expect(document.activeElement).toBe(arrow)
  })

  it('opens from Enter and Escape returns focus to that arrow', async () => {
    mount()
    const arrow = document.querySelector<HTMLButtonElement>('button.msg-open')!
    arrow.focus()
    arrow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(panel().hidden).toBe(false)
    expect(document.activeElement).toBe(panel())
    expect(panel().getAttribute('aria-modal')).toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(panel().hidden).toBe(true)
    expect(document.activeElement).toBe(arrow)
  })
})
