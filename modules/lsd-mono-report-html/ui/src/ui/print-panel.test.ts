// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { MessageEvent } from '../types'
import { componentGraph } from '../lib/component-graph'
import { bindInspector, inspectorMarkup, type PanelPrintView } from './inspector'
import { placePrintPanel, printMessageSection } from './print-panel'

const messageView: PanelPrintView = {
  view: 'message',
  title: 'reserveOrder(<cart>)',
  metaHtml: '<span class="pill">synchronous</span>',
  lead: null,
  text: '{\n  "cartId": "<cart_88>"\n}',
}

function card(id: string): string {
  return `<article class="scenario-card" id="card-${id}"><div class="scenario-body">
    <div class="cards"><section class="card"><h3>Description</h3></section></div>
    <section class="diagram-panel"></section>
  </div></article>`
}

const graph = componentGraph({
  participants: [
    { id: 'api', name: 'Api', type: 'participant' },
    { id: 'db', name: 'Database', type: 'database' },
  ],
  events: [{ kind: 'message', id: 'm1', from: 'api', to: 'db', label: 'insert', type: 'synchronous' }],
})

describe('printMessageSection', () => {
  it('prints the title, pills and the whole JSON, escaped', () => {
    const host = document.createElement('div')
    host.innerHTML = printMessageSection(messageView)
    const section = host.querySelector<HTMLElement>('section.print-panel.print-message')!
    expect(section.dataset.printPanel).toBe('message')
    expect(section.querySelector('h3')!.textContent).toBe('Message · reserveOrder(<cart>)')
    expect(section.querySelector('.meta-row .pill')!.textContent).toBe('synchronous')
    expect(section.querySelector('pre')!.textContent).toBe(messageView.text)
    expect(section.querySelectorAll('*')).toHaveLength(5)
  })

  it('leaves the JSON out while it is hidden in the panel, and prints an error lead', () => {
    const host = document.createElement('div')
    host.innerHTML = printMessageSection({ ...messageView, view: 'error', title: 'Boom', lead: 'bad', text: null })
    expect(host.querySelector('h3')!.textContent).toBe('Error · Boom')
    expect(host.querySelector('.print-lead')!.textContent).toBe('bad')
    expect(host.querySelector('pre')).toBeNull()
  })
})

describe('placePrintPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = `<main>${card('pay')}${card('stock')}</main>`
  })

  it('puts the copy in its scenario, straight after the sequence diagram', () => {
    placePrintPanel(document, { scenarioId: 'stock', html: printMessageSection(messageView) })
    const placed = document.querySelectorAll('.print-panel')
    expect(placed).toHaveLength(1)
    expect(placed[0].closest('.scenario-card')!.id).toBe('card-stock')
    expect(placed[0].previousElementSibling!.classList.contains('diagram-panel')).toBe(true)
    expect(placed[0].nextElementSibling).toBeNull()
  })

  it('keeps one copy, moves with the panel, and is removed when the panel closes', () => {
    placePrintPanel(document, { scenarioId: 'stock', html: printMessageSection(messageView) })
    placePrintPanel(document, { scenarioId: 'pay', html: printMessageSection(messageView) })
    expect([...document.querySelectorAll('.print-panel')].map((el) => el.closest('.scenario-card')!.id)).toEqual([
      'card-pay',
    ])
    placePrintPanel(document, null)
    expect(document.querySelectorAll('.print-panel')).toHaveLength(0)
  })

  it('does nothing when the scenario is filtered out', () => {
    placePrintPanel(document, { scenarioId: 'gone', html: printMessageSection(messageView) })
    expect(document.querySelectorAll('.print-panel')).toHaveLength(0)
  })
})

describe('inspector printView', () => {
  const msg: MessageEvent = {
    kind: 'message',
    id: 'm1',
    from: 'api',
    to: 'db',
    label: 'insert',
    type: 'synchronous',
    data: { body: { n: 1 } },
  }

  beforeEach(() => {
    document.body.innerHTML = `<div class="shell">${inspectorMarkup()}</div>`
  })

  it('is null while closed and reports the JSON once it is shown', async () => {
    let changes = 0
    const controller = bindInspector(document, {
      loadPayload: async () => undefined,
      onClose: () => {},
      onContent: () => {
        changes += 1
      },
    })
    expect(controller.printView()).toBeNull()
    controller.openMessage('pay', msg)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const view = controller.printView()!
    expect(changes).toBeGreaterThan(0)
    expect(view.view).toBe('message')
    expect(view.title).toBe('insert')
    expect(view.metaHtml).toContain('api → db')
    expect(JSON.parse(view.text!)).toEqual(msg.data)

    document.querySelector<HTMLButtonElement>('#inspector-json')!.click()
    expect(controller.printView()!.text).toBeNull()

    controller.close()
    expect(controller.printView()).toBeNull()
  })

  it('names a component link view, which prints as a Link (#105)', () => {
    const controller = bindInspector(document, { loadPayload: async () => undefined, onClose: () => {} })
    controller.openLink('pay', graph, 0, 'Pay')
    const view = controller.printView()!
    expect(view).toMatchObject({ view: 'link', text: null })
    expect(view.title).toContain(' → ')
    expect(printMessageSection(view)).toContain('<h3>Link · ')
  })
})
