import { describe, expect, it } from 'vitest'
import { parseReportHash, reportHash, writeReportHash } from './report-hash'

describe('reportHash / parseReportHash', () => {
  it('round-trips a scenario', () => {
    const hash = reportHash({ scenarioId: 'sc-happy' })
    expect(hash).toBe('#scenario=sc-happy')
    expect(parseReportHash(hash)).toEqual({ scenarioId: 'sc-happy' })
  })

  it('round-trips an open message', () => {
    const hash = reportHash({ scenarioId: 'sc-happy', messageId: 'm1' })
    expect(hash).toBe('#msg=sc-happy/m1')
    expect(parseReportHash(hash)).toEqual({ scenarioId: 'sc-happy', messageId: 'm1' })
  })

  it('encodes special characters in either id', () => {
    expect(reportHash({ scenarioId: 'sc/a', messageId: 'm 2' })).toBe('#msg=sc%2Fa/m%202')
    expect(parseReportHash('#msg=sc%2Fa/m%202')).toEqual({ scenarioId: 'sc/a', messageId: 'm 2' })
    expect(parseReportHash(reportHash({ scenarioId: 'a/b#c' }))).toEqual({ scenarioId: 'a/b#c' })
  })

  it('does not throw on an id with a lone surrogate', () => {
    expect(parseReportHash(reportHash({ scenarioId: 's\uD800', messageId: 'm\uDC00' }))).toEqual({
      scenarioId: 's\uFFFD',
      messageId: 'm\uFFFD',
    })
  })

  it('rejects unrelated and malformed fragments', () => {
    expect(parseReportHash('#section=pay')).toBeNull()
    expect(parseReportHash('')).toBeNull()
    expect(parseReportHash('#msg=only')).toBeNull()
    expect(parseReportHash('#msg=/m1')).toBeNull()
    expect(parseReportHash('#scenario=')).toBeNull()
    expect(parseReportHash('#scenario=%E0%A4%A')).toBeNull()
    expect(parseReportHash('scenario=x')).toEqual({ scenarioId: 'x' })
  })
})

describe('writeReportHash', () => {
  function fakeLocation(hash = '') {
    const calls: string[] = []
    return {
      calls,
      hash,
      replace(url: string) {
        calls.push(url)
        this.hash = url === '#' ? '' : url
      },
    }
  }

  it('replaces the hash as the scenario and the open message change', () => {
    const loc = fakeLocation()
    writeReportHash(loc, { scenarioId: 'sc-happy', messageId: 'm3' })
    expect(loc.hash).toBe('#msg=sc-happy/m3')
    writeReportHash(loc, { scenarioId: 'sc-happy' })
    expect(loc.hash).toBe('#scenario=sc-happy')
    writeReportHash(loc, null)
    expect(loc.calls).toEqual(['#msg=sc-happy/m3', '#scenario=sc-happy', '#'])
  })

  it('skips a write that changes nothing', () => {
    const loc = fakeLocation('#scenario=a')
    writeReportHash(loc, { scenarioId: 'a' })
    expect(loc.calls).toEqual([])
  })

  it('assigns the hash when replace throws (file pages)', () => {
    const loc = {
      hash: '',
      replace() {
        throw new Error('SecurityError')
      },
    }
    writeReportHash(loc, { scenarioId: 'b' })
    expect(loc.hash).toBe('#scenario=b')
  })
})
