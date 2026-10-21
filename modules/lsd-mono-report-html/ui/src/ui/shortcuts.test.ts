// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { SINGLE_KEYS_KEY, setSingleKeys, singleKeysEnabled } from './shortcuts'

afterEach(() => localStorage.clear())

describe('single-key shortcut preference', () => {
  it('is on until someone turns it off', () => {
    expect(singleKeysEnabled()).toBe(true)
  })

  it('remembers off, and forgets it again when turned back on', () => {
    setSingleKeys(false)
    expect(localStorage.getItem(SINGLE_KEYS_KEY)).toBe('off')
    expect(singleKeysEnabled()).toBe(false)
    setSingleKeys(true)
    expect(localStorage.getItem(SINGLE_KEYS_KEY)).toBeNull()
    expect(singleKeysEnabled()).toBe(true)
  })

  it('ignores any other stored value', () => {
    localStorage.setItem(SINGLE_KEYS_KEY, 'maybe')
    expect(singleKeysEnabled()).toBe(true)
  })
})
