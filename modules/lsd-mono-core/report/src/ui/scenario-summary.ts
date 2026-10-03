import type { Scenario } from '../types'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Search blob includes structured failure text, not only the narrative description. */
export function scenarioHaystack(s: Scenario): string {
  const err = s.error ? `${s.error.headline} ${s.error.message}` : ''
  const facts = s.facts.map((f) => `${f.key} ${f.value}`).join(' ')
  return `${s.title} ${s.description} ${err} ${facts}`
}

/** Legacy custom.js highlightKeywords: Given, When, Then, and And. Not But. */
const STEP_KEYWORD = /\b(Given|When|Then|And)\b/g

/**
 * Narrative [description] may still be HTML (sample reports already wrap
 * keywords in mark). Those are left as written so we do not double-wrap.
 * Plain text (Cucumber step lines) is escaped, then keywords are highlighted,
 * then newlines become line breaks. Failure message and stack are structured
 * fields: message is escaped text, stack is not inlined (the shell opens it
 * in the inspector).
 */
export function narrativeHtml(description: string): string {
  if (description.includes('<mark')) return description
  return escapeHtml(description)
    .replace(STEP_KEYWORD, '<mark>$1</mark>')
    .replace(/\r\n|\n|\r/g, '<br>')
}

export function scenarioDescriptionHtml(s: Scenario): string {
  const error = s.error
  const errorHtml = error
    ? `<div class="error-panel">
        <p class="error-headline">${escapeHtml(error.headline)}</p>
        <p class="error-message">${escapeHtml(error.message)}</p>
        ${
          error.stack
            ? `<button type="button" class="text-btn" data-show-error="${escapeAttr(s.id)}">Show stack trace</button>`
            : ''
        }
      </div>`
    : ''
  return `<div class="narrative">${narrativeHtml(s.description)}</div>${errorHtml}`
}
