import { describe, expect, it } from 'vitest'
import type { Insight } from '../types'
import { truncateLabel } from './format'
import { insightsListHtml } from './insights'

const slow: Insight = {
  rank: 1,
  kind: 'bottleneck',
  participant: 'orders-db',
  label: 'abcdefghijklmnopqrstuvwxyz',
  from: 'api',
  to: 'orders-db',
  messageId: 'm2',
  totalMs: 80,
  isolatedMs: 80,
}

describe('truncateLabel', () => {
  it('keeps short labels and ellipsises past the max width', () => {
    expect(truncateLabel('POST /checkout', 200)).toBe('POST /checkout')
    expect(truncateLabel('abcdefghijklmnopqrstuvwxyz', 12)).toBe('abcdefghi...')
    expect(truncateLabel('  spaced  ', 200)).toBe('spaced')
  })
})

describe('insightsListHtml', () => {
  it('renders rank and kind as text, truncates the label, and offers show', () => {
    const html = insightsListHtml([slow], 12)
    expect(html).toContain('#1')
    expect(html).toContain('bottleneck')
    expect(html).toContain('80 ms isolated')
    expect(html).toContain('orders-db')
    expect(html).toContain('abcdefghi...')
    expect(html).toContain('title="abcdefghijklmnopqrstuvwxyz"')
    expect(html).toContain('data-show-message="m2"')
    expect(html).toContain('>show<')
    expect(html).not.toMatch(/style="[^"]*color/)
  })

  it('is empty when insights are missing', () => {
    expect(insightsListHtml(undefined, 200)).toBe('')
    expect(insightsListHtml([], 200)).toBe('')
  })
})
