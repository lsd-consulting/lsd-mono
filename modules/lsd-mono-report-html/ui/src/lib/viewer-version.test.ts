import { describe, expect, it } from 'vitest'
import { writtenBy } from './viewer-version'

describe('writtenBy', () => {
  it.each([
    [{ name: 'lsd-mono-jvm', version: '0.15.0' }, '0.15.0', 'lsd-mono-jvm'],
    [{ name: 'lsd-mono-jvm', version: '0.14.0' }, '0.15.0', 'lsd-mono-jvm 0.14.0'],
    [{ name: 'lsd-mono-jvm', version: '0.15.1-SNAPSHOT' }, '0.15.1-SNAPSHOT', 'lsd-mono-jvm'],
    [{ name: 'lsd-mono-jvm', version: '0.15.1-SNAPSHOT' }, '0.15.0', 'lsd-mono-jvm 0.15.1-SNAPSHOT'],
    [{ name: 'lsd-mono-jvm', version: '0.15.0' }, 'dev', 'lsd-mono-jvm 0.15.0'],
    [{ name: 'lsd-mono-jvm', version: 'unknown' }, '0.15.0', 'lsd-mono-jvm unknown'],
    [{ name: 'my-adapter' }, '0.15.0', 'my-adapter'],
    [{ name: '0.15.0' }, '0.15.0', '0.15.0'],
  ])('%o on a %s page reads %s', (generator, version, shown) => {
    expect(writtenBy(generator, version)).toBe(shown)
  })
})
