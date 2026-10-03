import { describe, expect, it } from 'vitest'
import type { Scenario } from '../types'
import { scenarioDescriptionHtml, scenarioHaystack } from './scenario-summary'

function scenario(partial: Partial<Scenario>): Scenario {
  return {
    id: 'sc-1',
    title: 'blows up',
    status: 'error',
    description: 'Test failed',
    facts: [],
    metrics: [],
    participants: [],
    events: [],
    ...partial,
  }
}

describe('scenarioDescriptionHtml', () => {
  it('escapes structured failure text and does not emit overlay markup', () => {
    const html = scenarioDescriptionHtml(
      scenario({
        error: {
          headline: 'Failed',
          message: 'boom: payload <script>',
          stack: 'java.lang.IllegalStateException: boom\n\tat Test',
        },
      }),
    )
    expect(html).toContain('Test failed')
    expect(html).toContain('Failed')
    expect(html).toContain('boom: payload &lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('overlay')
    expect(html).not.toContain('href=')
    expect(html).toContain('data-show-error="sc-1"')
    expect(html).toContain('Show stack trace')
    // stack stays out of the card; the dialog reads it from the model
    expect(html).not.toContain('IllegalStateException')
  })

  it('omits the stack button when there is no stack', () => {
    const html = scenarioDescriptionHtml(
      scenario({ error: { headline: 'Failed', message: 'nope' } }),
    )
    expect(html).toContain('nope')
    expect(html).not.toContain('data-show-error')
  })
})

describe('scenarioHaystack', () => {
  it('includes the failure message so search can find it', () => {
    const hay = scenarioHaystack(
      scenario({ error: { headline: 'Failed', message: 'inventory timeout' } }),
    )
    expect(hay).toContain('inventory timeout')
    expect(hay).toContain('Failed')
  })
})
