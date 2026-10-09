import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8')

/** Body of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const match = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
  expect(match, `${selector} not found`).not.toBeNull()
  return match![2]
}

describe('main content width', () => {
  it('has no width cap, so it fills the space the sidebar and side panel leave', () => {
    expect(rule('.main')).not.toMatch(/max-width/)
  })
})

describe('top bar on a narrow screen', () => {
  it('gives the bar an auto row, so it holds its wrapped search and status filters', () => {
    // A fixed row clamped the sticky bar, and the filters floated over the page on phones.
    expect(rule('#app')).toMatch(/grid-template-rows:\s*auto\s+1fr/)
  })

  it('sizes the one-row bar from its token, not from the tracked --topbar-h', () => {
    // --topbar-h follows the measured bar. Sizing the bar from it would keep a phone's
    // three-row height after the window widens.
    expect(rule('.topbar')).toMatch(/height:\s*var\(--topbar-row-h\)/)
  })

  it('stops in-page jumps below the sticky bar', () => {
    expect(rule('html')).toMatch(/scroll-padding-top:\s*var\(--topbar-h\)/)
  })
})
