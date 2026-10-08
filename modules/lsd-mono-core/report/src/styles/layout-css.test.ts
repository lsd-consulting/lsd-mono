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
