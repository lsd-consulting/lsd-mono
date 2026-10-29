import { describe, expect, it } from 'vitest'
import type { MessageEvent, Scenario } from '../../types'
import { messageKind, messageSpeech, textViewHtml } from './text-view'

const participants = [
  { id: 'web', name: 'Web UI' },
  { id: 'gw', name: 'Gateway' },
]

function msg(over: Partial<MessageEvent>): MessageEvent {
  return { kind: 'message', id: 'm', from: 'web', to: 'gw', label: 'POST /checkout', type: 'SYNCHRONOUS', ...over }
}

describe('messageSpeech', () => {
  it('says who calls whom, the kind, label, duration, status and payload', () => {
    const text = messageSpeech(msg({ durationMs: 586, status: '200', data: { a: 1 } }), participants)
    expect(text).toBe('Web UI to Gateway, call: POST /checkout, 586 ms, status 200, has payload')
  })

  it('calls out an error status and omits what is absent', () => {
    expect(messageSpeech(msg({ status: '503', type: 'SYNCHRONOUS_RESPONSE' }), participants)).toBe(
      'Web UI to Gateway, reply: POST /checkout, error, status 503',
    )
  })

  it('says async in the label, so the dotted arrow is not a visual-only cue', () => {
    expect(messageSpeech(msg({ type: 'ASYNCHRONOUS', label: 'OrderPlaced' }), participants)).toBe(
      'Web UI to Gateway, async: OrderPlaced',
    )
  })

  it('names self calls and the one end of a short message', () => {
    expect(messageKind(msg({ to: 'web' }))).toBe('self call')
    expect(messageSpeech(msg({ type: 'SHORT_INBOUND', from: '' }), participants)).toContain('to Gateway, inbound')
  })

  it('puts the label first for a button name', () => {
    expect(messageSpeech(msg({}), participants, true)).toBe('POST /checkout, Web UI to Gateway, call')
  })
})

describe('textViewHtml', () => {
  const events = [
    { kind: 'section', id: 's', title: 'Checkout' },
    msg({ id: 'a' }),
    msg({ id: 'b', label: 'gone', from: 'gw', to: 'gw' }),
    { kind: 'note', id: 'n', text: 'a <note>' },
  ] as Scenario['events']

  it('lists every message in order under its section heading, escaped', () => {
    const html = textViewHtml({ participants } as Scenario, events, new Set())
    expect(html.indexOf('<h4>Checkout</h4>')).toBeLessThan(html.indexOf('POST /checkout'))
    expect(html.match(/<li/g)).toHaveLength(4)
    expect(html).toContain('Note: a &lt;note&gt;')
  })

  it('leaves out messages whose participant is hidden', () => {
    const html = textViewHtml({ participants } as Scenario, events, new Set(['gw']))
    expect(html).not.toContain('gone')
    expect(html).not.toContain('POST /checkout')
  })
})
