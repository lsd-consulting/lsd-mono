// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Scenario } from '../types'
import { HEADER_BLOCK_H } from './layout'
import { PRINT_MAX_UPSCALE, bindDiagramScroll, renderDiagramHtml, syncDiagramWindow } from './sequence-diagram'

/** Long enough that the screen window paints only some of the rows. */
const scenario: Scenario = {
  id: 'sc-print',
  title: 'Print',
  status: 'success',
  description: '',
  facts: [],
  metrics: [],
  participants: [
    { id: 'api', name: 'Api', type: 'PARTICIPANT' },
    { id: 'db', name: 'Db', type: 'DATABASE' },
  ],
  events: Array.from({ length: 80 }, (_, i) => ({
    kind: 'message' as const,
    id: `m${i}`,
    from: i % 2 ? 'db' : 'api',
    to: i % 2 ? 'api' : 'db',
    label: `step ${i}`,
    type: i % 2 ? ('SYNCHRONOUS_RESPONSE' as const) : ('SYNCHRONOUS' as const),
  })),
}

function labels(): string[] {
  return [...document.querySelectorAll('.seq-window .msg-label')].map((el) => el.textContent ?? '')
}

describe('sequence diagram in print', () => {
  let scroll: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = `<div id="root">${renderDiagramHtml(scenario)}</div>`
    scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 240 })
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 600 })
    const header = scroll.querySelector<HTMLElement>('.seq-sticky-header')!
    Object.defineProperty(header, 'offsetHeight', { configurable: true, value: HEADER_BLOCK_H })
    bindDiagramScroll(document.getElementById('root')!)
    syncDiagramWindow(scroll)
  })

  it('caps the printed width from the unzoomed drawing width', () => {
    const root = document.querySelector<HTMLElement>('.seq-diagram')!
    const svg = document.querySelector<SVGSVGElement>('.seq-header-svg')!
    const total = Number(svg.getAttribute('viewBox')!.split(' ')[2])
    expect(root.style.getPropertyValue('--seq-print-max')).toBe(`${Math.round(total * PRINT_MAX_UPSCALE)}px`)
  })

  it('paints every row from the top while printing, so the drawing can scale to the page', () => {
    expect(labels().length).toBeLessThan(80)
    window.dispatchEvent(new Event('beforeprint'))
    expect(labels()).toHaveLength(80)
    const svg = document.querySelector<SVGSVGElement>('.seq-window .seq-svg')!
    expect(Number(svg.getAttribute('viewBox')!.split(' ')[1])).toBe(0)
    expect(document.querySelector<HTMLElement>('.seq-window')!.style.transform).toBe('translateY(0px)')
    window.dispatchEvent(new Event('afterprint'))
    expect(labels().length).toBeLessThan(80)
  })
})
