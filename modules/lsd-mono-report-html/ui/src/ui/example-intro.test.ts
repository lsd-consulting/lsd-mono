import { describe, expect, it } from 'vitest'
import { exampleIntroHtml, introDismissed, isExamplePage, rememberIntroDismissed } from './example-intro'

const at = (hostname: string, pathname: string) => ({ hostname, pathname })

describe('example intro (#161)', () => {
  it('shows only on the published example, never on a generated report', () => {
    expect(isExamplePage(at('lsd-consulting.github.io', '/lsd-mono/'))).toBe(true)
    expect(isExamplePage(at('lsd-consulting.github.io', '/lsd-mono/example-report.html'))).toBe(true)
    expect(isExamplePage(at('lsd-consulting.github.io', '/lsd-mono/spring-boot-4/'))).toBe(false)
    expect(isExamplePage(at('', '/Users/me/build/lsd/index.html'))).toBe(false)
    expect(isExamplePage(at('ci.example.com', '/lsd-mono/'))).toBe(false)
    expect(isExamplePage(at('localhost', '/'), true)).toBe(true)
  })

  it('says what LSD and the example are, and links on with descriptive text', () => {
    const html = exampleIntroHtml()
    expect(html).toContain('aria-labelledby="example-intro-title"')
    expect(html).toContain('14 services')
    expect(html).toMatch(/>Read the LSD README</)
    for (const demo of ['spring-boot-4', 'http4k-6', 'ktor-3'])
      expect(html).toContain(`https://lsd-consulting.github.io/lsd-mono/${demo}/`)
    expect(html).not.toMatch(/node/i)
  })

  it('remembers a dismissal, and survives storage that throws', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    expect(introDismissed(storage)).toBe(false)
    rememberIntroDismissed(storage)
    expect(introDismissed(storage)).toBe(true)
    const broken = {
      getItem: () => {
        throw new Error('off')
      },
      setItem: () => {
        throw new Error('off')
      },
    }
    expect(introDismissed(broken)).toBe(false)
    expect(() => rememberIntroDismissed(broken)).not.toThrow()
  })
})
