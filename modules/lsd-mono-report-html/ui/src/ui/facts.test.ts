import { describe, expect, it } from 'vitest'
import { factsHtml } from './facts'

describe('factsHtml', () => {
  it('keeps a one-line fact beside its key', () => {
    expect(factsHtml([{ key: 'framework', value: 'junit <6>' }])).toBe('<dt>framework</dt><dd>junit &lt;6&gt;</dd>')
  })

  it('shows a fact of several lines as escaped preformatted text across the card', () => {
    const html = factsHtml([{ key: 'Test source', value: '@Test\nfun `a <b>`() {\n    go("&")\n}' }])
    expect(html).toBe(
      '<dt>Test source</dt><dd class="kv-block"><pre tabindex="0" aria-label="Test source"><code>' +
        '@Test\nfun `a &lt;b&gt;`() {\n    go("&amp;")\n}</code></pre></dd>',
    )
  })

  it('escapes the key in the label too', () => {
    expect(factsHtml([{ key: 'a"b', value: 'x\ny' }])).toContain('aria-label="a&quot;b"')
  })
})
