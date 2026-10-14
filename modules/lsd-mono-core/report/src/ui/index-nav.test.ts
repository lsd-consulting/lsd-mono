// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { IndexManifest, IndexReport } from '../lib/report-index'
import { indexNavHtml, outcomeSummary, type IndexNavState } from './index-nav'

const failed: IndexReport = {
  id: 'checkout',
  title: 'Checkout <tests>',
  status: 'error',
  href: 'checkout-diagram.html',
  data: 'checkout-report.js',
  counts: { success: 1, warn: 0, error: 1 },
  scenarios: [
    { id: 's1', title: 'Place an order', status: 'success', messages: 2 },
    { id: 's2', title: 'Card declined', status: 'error', messages: 3 },
  ],
}
const passed: IndexReport = {
  id: 'shipping',
  title: 'Shipping',
  status: 'success',
  href: 'shipping-diagram.html',
  data: 'shipping-report.js',
  counts: { success: 1, warn: 0, error: 0 },
  scenarios: [{ id: 's1', title: 'Track parcel', status: 'success', messages: 1 }],
}
const link: IndexReport = {
  id: 'x',
  title: 'Elsewhere',
  status: 'warn',
  href: 'elsewhere.html',
  counts: { success: 0, warn: 0, error: 0 },
  scenarios: [],
}
const manifest: IndexManifest = {
  title: 'LSD reports',
  generatedAt: '',
  generator: '',
  reports: [failed, passed, link],
}
const base: IndexNavState = {
  reportId: 'checkout',
  selectedId: 's2',
  expanded: new Set(['checkout']),
  query: '',
  status: { success: true, warn: true, error: true },
  collapsed: false,
}

function nav(state: Partial<IndexNavState> = {}): HTMLElement {
  const ul = document.createElement('ul')
  ul.innerHTML = indexNavHtml(manifest, { ...base, ...state })
  return ul
}

describe('index sidebar', () => {
  it('lists one group per report and the open report’s scenarios, with the shown one current', () => {
    const ul = nav()
    expect([...ul.querySelectorAll('.nav-group-title')].map((el) => el.textContent)).toEqual([
      'Checkout <tests>',
      'Shipping',
      'Elsewhere',
    ])
    expect([...ul.querySelectorAll('[data-nav]')].map((el) => el.getAttribute('data-nav'))).toEqual(['s1', 's2'])
    expect(ul.querySelector('[aria-current="true"]')?.getAttribute('data-nav')).toBe('s2')
    expect(ul.querySelector('[data-group="checkout"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(ul.querySelector('[data-group="shipping"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(ul.querySelector('#nav-group-shipping')?.hasAttribute('hidden')).toBe(true)
    expect(ul.querySelector('a.nav-group-head')?.getAttribute('href')).toBe('elsewhere.html')
    expect(ul.querySelector('.nav-group.current .nav-meta')?.textContent).toBe('1 error · 1 success')
  })

  it('opens every matching group while searching and leaves out groups with no match', () => {
    const ul = nav({ query: 'parcel' })
    expect([...ul.querySelectorAll('.nav-group-title')].map((el) => el.textContent)).toEqual(['Shipping'])
    expect(ul.querySelector('[data-nav]')?.getAttribute('data-report')).toBe('shipping')
    expect(nav({ query: 'nothing here' }).querySelector('.nav-empty')?.textContent).toBe('No reports match.')
  })

  it('searches the open report’s loaded data', () => {
    const ul = nav({ query: 'ord-1001', matchesLoaded: (id) => id === 's1' })
    expect([...ul.querySelectorAll('[data-nav]')].map((el) => el.getAttribute('data-nav'))).toEqual(['s1'])
  })

  it('hides scenarios the status filters turn off', () => {
    const ul = nav({ status: { success: false, warn: true, error: true } })
    expect([...ul.querySelectorAll('[data-nav]')].map((el) => el.getAttribute('data-nav'))).toEqual(['s2'])
    expect([...ul.querySelectorAll('.nav-group-title')].map((el) => el.textContent)).toEqual([
      'Checkout <tests>',
      'Elsewhere',
    ])
  })

  it('moves names into tooltips on the icon rail', () => {
    const ul = nav({ collapsed: true })
    expect(ul.querySelector('[data-group="checkout"]')?.getAttribute('title')).toBe(
      'Checkout <tests>: 1 error · 1 success',
    )
    expect(ul.querySelector('a.nav-group-head')?.getAttribute('title')).toBe('Elsewhere: no scenarios')
    expect(ul.querySelector('[data-nav="s2"]')?.getAttribute('title')).toBe('Card declined. Error · 3 messages')
  })

  it('summarises outcomes failures first', () => {
    expect(outcomeSummary({ success: 2, warn: 1, error: 3 })).toBe('3 error · 1 warn · 2 success')
    expect(outcomeSummary({ success: 0, warn: 0, error: 0 })).toBe('')
  })
})
