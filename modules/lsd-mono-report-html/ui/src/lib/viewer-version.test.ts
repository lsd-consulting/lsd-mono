import { describe, expect, it } from 'vitest'
import { writtenBy } from './viewer-version'

describe('writtenBy', () => {
  it.each([
    ['lsd-mono-jvm 0.15.0', '0.15.0', 'lsd-mono-jvm'],
    ['lsd-mono-jvm 0.14.0', '0.15.0', 'lsd-mono-jvm 0.14.0'],
    ['lsd-mono-jvm 0.15.1-SNAPSHOT', '0.15.1-SNAPSHOT', 'lsd-mono-jvm'],
    ['lsd-mono-jvm 0.15.1-SNAPSHOT', '0.15.0', 'lsd-mono-jvm 0.15.1-SNAPSHOT'],
    ['lsd-mono-jvm 0.15.0', 'dev', 'lsd-mono-jvm 0.15.0'],
    ['lsd-mono-jvm unknown', '0.15.0', 'lsd-mono-jvm unknown'],
    ['my-adapter', '0.15.0', 'my-adapter'],
    ['0.15.0', '0.15.0', '0.15.0'],
  ])('%s on a %s page reads %s', (generator, version, shown) => {
    expect(writtenBy(generator, version)).toBe(shown)
  })
})
