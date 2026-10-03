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

  it('renders plain cucumber steps as highlighted lines and escapes the rest', () => {
    const html = scenarioDescriptionHtml(
      scenario({
        description:
          'Given a customer is ready <script>\nWhen the customer places an order\nThen the order is stored\nAnd the receipt is sent\nBut stock is unchanged',
      }),
    )
    expect(html).toContain('<mark>Given</mark> a customer is ready &lt;script&gt;<br>')
    expect(html).toContain('<br><mark>When</mark> the customer places an order<br>')
    expect(html).toContain('<br><mark>Then</mark> the order is stored<br>')
    expect(html).toContain('<br><mark>And</mark> the receipt is sent<br>')
    expect(html).toContain('But stock is unchanged')
    expect(html).not.toContain('<mark>But</mark>')
    expect(html).not.toContain('<script>')
    expect(html.match(/<mark>/g)).toHaveLength(4)
  })

  it('does not double-wrap descriptions that already highlight keywords', () => {
    const description =
      '<p><mark>Given</mark> a cart<br/><mark>When</mark> they pay<br/><mark>Then</mark> it confirms.</p>'
    const html = scenarioDescriptionHtml(scenario({ description }))
    expect(html).toContain(description)
    expect(html).not.toContain('<mark><mark>')
    expect(html).not.toContain('&lt;mark&gt;')
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
