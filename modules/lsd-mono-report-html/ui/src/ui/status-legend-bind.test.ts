// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { bindStatusLegend, statusLegendHtml } from './status-legend'

const button = () => document.querySelector<HTMLButtonElement>('#btn-status-legend')!
const legend = () => document.querySelector<HTMLElement>('#status-legend')!
const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

beforeEach(() => {
  document.body.innerHTML = `<a href="#x" id="elsewhere">x</a>${statusLegendHtml()}`
  bindStatusLegend(document)
})

describe('status legend (#163)', () => {
  it('opens and closes from the ?', () => {
    expect(legend().hidden).toBe(true)
    button().click()
    expect(legend().hidden).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    button().click()
    expect(legend().hidden).toBe(true)
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Esc from the legend and gives focus back to the ?', () => {
    button().click()
    key(legend(), 'Enter')
    expect(legend().hidden).toBe(false)
    key(legend(), 'Escape')
    expect(legend().hidden).toBe(true)
    expect(document.activeElement).toBe(button())
  })

  it('ignores Esc while closed', () => {
    key(button(), 'Escape')
    expect(legend().hidden).toBe(true)
  })

  it('closes on a click away, but not on a click inside', () => {
    button().click()
    legend().click()
    expect(legend().hidden).toBe(false)
    document.querySelector<HTMLElement>('#elsewhere')!.click()
    expect(legend().hidden).toBe(true)
  })
})
