import { describe, expect, it } from 'vitest'
import {
  clearMessageHash,
  isMessageHash,
  messageHash,
  parseMessageHash,
  writeMessageHash,
} from './message-url'

describe('messageHash / parseMessageHash', () => {
  it('round-trips a scenario and message id', () => {
    const hash = messageHash('sc-happy', 'm1')
    expect(hash).toBe('#msg=sc-happy/m1')
    expect(parseMessageHash(hash)).toEqual({ scenarioId: 'sc-happy', messageId: 'm1' })
  })

  it('encodes special characters in either id', () => {
    const hash = messageHash('sc/a', 'm 2')
    expect(hash).toBe('#msg=sc%2Fa/m%202')
    expect(parseMessageHash(hash)).toEqual({ scenarioId: 'sc/a', messageId: 'm 2' })
  })

  it('rejects unrelated fragments', () => {
    expect(parseMessageHash('#section=pay')).toBeNull()
    expect(parseMessageHash('')).toBeNull()
    expect(parseMessageHash('#msg=only')).toBeNull()
    expect(isMessageHash('#msg=sc-happy/m1')).toBe(true)
    expect(isMessageHash('#other')).toBe(false)
  })
})

describe('writeMessageHash / clearMessageHash', () => {
  it('sets the hash when a message opens and clears it on close', () => {
    const calls: string[] = []
    const loc = {
      hash: '',
      replace(url: string) {
        calls.push(url)
        this.hash = url === '#' ? '' : url
      },
    }
    writeMessageHash(loc, { scenarioId: 'sc-happy', messageId: 'm3' })
    expect(loc.hash).toBe('#msg=sc-happy/m3')
    expect(calls).toEqual(['#msg=sc-happy/m3'])
    clearMessageHash(loc)
    expect(loc.hash).toBe('')
    expect(calls[1]).toBe('#')
  })

  it('leaves a non-message hash alone when clearing', () => {
    const loc = { hash: '#section=pay', replace(url: string) { this.hash = url } }
    clearMessageHash(loc)
    expect(loc.hash).toBe('#section=pay')
  })
})
