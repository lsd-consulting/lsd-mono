import { describe, expect, it } from 'vitest'
import type { MessageEvent } from '../types'
import { messageMetaHtml } from '../ui/inspector-views'
import { isErrorStatus } from './status'

describe('isErrorStatus', () => {
  it('matches the Errors metric: 4xx and 5xx codes, or an error word with no code', () => {
    for (const s of ['400', '404 Not Found', '503', '599', 'error', 'FAILED', 'Timed out', 'payment rejected'])
      expect(isErrorStatus(s), s).toBe(true)
    for (const s of ['200', '201 Created', '302', '600', 'ok', 'AUTHORISED', '200 error page', ''])
      expect(isErrorStatus(s), s).toBe(false)
  })
})

describe('message status pill', () => {
  const msg = (status?: string, data?: unknown): MessageEvent => ({
    kind: 'message',
    id: 'm',
    from: 'pay',
    to: 'api',
    label: 'reply',
    type: 'SYNCHRONOUS_RESPONSE',
    status,
    data,
  })

  it('names an error status in words and does not repeat the payload status', () => {
    const html = messageMetaHtml('sc', msg('503', { status: 503 }))
    expect(html).toContain('<span class="pill error" title="Counted in the Errors metric">503 · error</span>')
    expect(html.match(/>503/g)).toHaveLength(1)
  })

  it('shows a success status plainly, and nothing without one', () => {
    expect(messageMetaHtml('sc', msg('201 Created'))).toContain('<span class="pill">201 Created</span>')
    expect(messageMetaHtml('sc', msg())).not.toContain('pill error')
  })
})
