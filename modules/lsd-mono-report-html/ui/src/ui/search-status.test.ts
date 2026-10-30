import { expect, it } from 'vitest'
import { searchStatusText } from './search-status'

it('says how many scenarios the search shows (#162)', () => {
  expect(searchStatusText(2, 5, true)).toBe('2 of 5 scenarios')
  expect(searchStatusText(5, 5, false)).toBe('5 scenarios')
  expect(searchStatusText(0, 1, true)).toBe('0 of 1 scenario')
})
