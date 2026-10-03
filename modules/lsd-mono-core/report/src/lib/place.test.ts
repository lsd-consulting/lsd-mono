// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Scenario } from '../types'
import { bindInspector, inspectorMarkup } from '../ui/inspector'
import { clearMessageHash, parseMessageHash, writeMessageHash } from './message-url'
import {
  bindDiagramScroll,
  messageOffsetY,
  mountDiagram,
  renderDiagramHtml,
  syncDiagramWindow,
  syncMinimap,
} from './sequence-diagram'
import { HEADER_BLOCK_H } from './layout'
import { minimapViewportRange, scrollTopFromMinimapFraction } from './minimap'

const scenario: Scenario = {
  id: 'sc-happy',
  title: 'Happy',
  status: 'success',
  description: '',
  facts: [],
  metrics: [],
  participants: [
    { id: 'a', name: 'A', type: 'PARTICIPANT' },
    { id: 'b', name: 'B', type: 'PARTICIPANT' },
  ],
  events: Array.from({ length: 40 }, (_, i) => ({
    kind: 'message' as const,
    id: `m${i + 1}`,
    from: 'a',
    to: 'b',
    label: `hop ${i + 1}`,
    type: 'SYNCHRONOUS' as const,
    data: { method: 'POST', path: `/${i + 1}`, status: 200 },
  })),
}

describe('minimap place', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="root">${renderDiagramHtml(scenario)}</div>`
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    // happy-dom often reports 0 for layout; stub the metrics the strip needs.
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 240 })
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 640 })
    const header = scroll.querySelector<HTMLElement>('.seq-sticky-header')!
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: HEADER_BLOCK_H })
    const minimap = document.querySelector<HTMLElement>('.seq-minimap')!
    Object.defineProperty(minimap, 'clientHeight', { configurable: true, value: 240 })
    Object.defineProperty(minimap, 'clientWidth', { configurable: true, value: 14 })
    bindDiagramScroll(document.getElementById('root')!)
  })

  it('keeps the viewport marker aligned with scroll', () => {
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    const marker = document.querySelector<HTMLElement>('.seq-minimap-window')!
    const diagram = mountDiagram(scenario)
    scroll.scrollTop = 400
    syncDiagramWindow(scroll)
    syncMinimap(scroll)
    const expected = minimapViewportRange({
      scrollTop: 400,
      viewportHeight: 240,
      headerHeight: HEADER_BLOCK_H,
      contentHeight: diagram.height,
    })
    expect(marker.style.top).toBe(`${expected.top * 100}%`)
    expect(parseFloat(marker.style.height)).toBeCloseTo(Math.max(expected.height * 100, 2), 5)
  })

  it('moves the detail window when the strip is activated', () => {
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    const diagram = mountDiagram(scenario)
    const next = scrollTopFromMinimapFraction({
      fractionY: 0.6,
      viewportHeight: 240,
      headerHeight: HEADER_BLOCK_H,
      contentHeight: diagram.height,
    })
    scroll.scrollTop = next
    syncDiagramWindow(scroll)
    expect(scroll.scrollTop).toBe(next)
    expect(messageOffsetY(scenario.id, 'm20')).toBeGreaterThan(0)
  })
})

describe('open message in the URL', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="shell">
        <button type="button" class="msg-open" data-message-id="m1">arrow</button>
        ${inspectorMarkup()}
      </div>`
    ;(window as unknown as { locationHash: string }).locationHash = ''
  })

  it('writes the message hash on open and clears it on close', () => {
    const loc = {
      hash: '',
      replace(url: string) {
        this.hash = url === '#' ? '' : url
      },
    }
    const message = scenario.events[0]
    if (message.kind !== 'message') throw new Error('expected message')
    const controller = bindInspector(document, {
      loadPayload: async () => ({ body: 'lazy' }),
      onClose: () => clearMessageHash(loc),
    })
    writeMessageHash(loc, { scenarioId: scenario.id, messageId: message.id })
    controller.openMessage(scenario.id, message)
    expect(parseMessageHash(loc.hash)).toEqual({ scenarioId: 'sc-happy', messageId: 'm1' })
    controller.close()
    expect(loc.hash).toBe('')
    expect(parseMessageHash(loc.hash)).toBeNull()
  })
})
