// The Key facts list on the scenario card. A one-line value sits beside its key; a value of
// several lines (the JUnit test method's source, #72) gets the full width as preformatted text,
// scrollable and keyboard-focusable, so its line breaks and indentation survive.
import type { Fact } from '../types'
import { escapeAttr, escapeHtml } from '../lib/escape'

export function factsHtml(facts: readonly Fact[]): string {
  return facts.map(factHtml).join('')
}

function factHtml(f: Fact): string {
  if (!f.value.includes('\n')) return `<dt>${escapeHtml(f.key)}</dt><dd>${escapeHtml(f.value)}</dd>`
  return `<dt>${escapeHtml(f.key)}</dt><dd class="kv-block"><pre tabindex="0" aria-label="${escapeAttr(f.key)}"><code>${escapeHtml(f.value)}</code></pre></dd>`
}
