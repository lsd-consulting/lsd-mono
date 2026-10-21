// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'
import { conformanceText } from './lib/conformance.test-util'
import type { Report } from './types'

/**
 * End to end (#28): the whole report UI, booted on a report whose every string is
 * hostile, must show that text as text and create no element or attribute from it.
 */
const ATTACK = `"'><img src=x onerror=alert(1) data-pwned=1></script><!--<svg onload=alert(2)>`
const H = (tag: string) => `${tag}${ATTACK}\u2028\u2029\u0001\uD800`

// The shared test reports' hostile report: every string hostile, with wrong types and enums too, so
// the schema rejects it; the page must still show it safely.
const hostile = JSON.parse(conformanceText('invalid/hostile.json')) as Report

function injected(root: ParentNode): string[] {
  const found: string[] = []
  root.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'img' || tag === 'script' || tag === 'iframe') found.push(`<${tag}>`)
    if (tag === 'svg' && el.hasAttribute('onload')) found.push('<svg onload>')
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on') || attr.name === 'data-pwned' || attr.name === 'src')
        found.push(`${tag}[${attr.name}]`)
    }
  })
  return found
}

describe('report UI with hostile report data', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    window.__LSD_REPORT__ = hostile
    await import('./main')
  })

  it('renders the shell, scenario card and diagram without injecting markup', () => {
    expect(document.querySelector('.scenario-card')).not.toBeNull()
    expect(document.querySelector('.seq-scroll')).not.toBeNull()
    expect(injected(document.body)).toEqual([])
  })

  it('shows hostile text as text', () => {
    const text = document.body.textContent ?? ''
    for (const tag of ['title', 'scenario title', 'fact key', 'fact value', 'headline', 'message', 'description']) {
      expect(text).toContain(`${tag}${ATTACK}`)
    }
    expect(document.querySelector('.scenario-card mark')?.textContent).toBe('Given')
    expect(document.querySelector('.narrative p')).toBeNull()
  })

  it('keeps hostile ids inside their attributes', () => {
    const card = document.querySelector('.scenario-card')!
    expect(card.id).toBe(`card-${H('scenario')}`)
    const nav = document.querySelector<HTMLElement>('[data-nav]')!
    expect(nav.dataset.nav).toBe(card.id.slice('card-'.length))
  })

  it('opens the metrics, error and message views without injecting markup', () => {
    document.querySelector<HTMLButtonElement>('[data-show-metrics]')?.click()
    expect(injected(document.body)).toEqual([])
    document.querySelector<HTMLButtonElement>('[data-show-error]')?.click()
    expect(injected(document.body)).toEqual([])
    const open = document.querySelector<HTMLButtonElement>('button.msg-open')
    expect(open).not.toBeNull()
    open!.click()
    expect(injected(document.body)).toEqual([])
    expect(document.body.textContent).toContain(`method${ATTACK}`)
  })
})
