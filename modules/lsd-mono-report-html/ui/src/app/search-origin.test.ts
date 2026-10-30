import { describe, expect, it } from 'vitest'
import { forgetSearchOrigin, searchOriginAfter } from './search-origin'

describe('search origin (#162)', () => {
  it('clearing a search goes back to the scenario open when it began', () => {
    expect(searchOriginAfter('', 'd', 'a')).toBeNull()
    expect(searchOriginAfter('d', 'de', 'b')).toBeNull()
    expect(searchOriginAfter('de', '', 'b')).toBe('a')
    expect(searchOriginAfter('', '', 'b')).toBeNull()
  })
  it('a scenario chosen while searching is kept', () => {
    searchOriginAfter('', 'd', 'a')
    forgetSearchOrigin()
    expect(searchOriginAfter('d', '', 'c')).toBeNull()
  })
})
