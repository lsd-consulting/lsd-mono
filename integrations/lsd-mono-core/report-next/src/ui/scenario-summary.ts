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

/**
 * Narrative [description] may still be HTML (sample reports).
 * Failure message and stack are structured fields: message is escaped text,
 * stack is not inlined (the shell opens it in the inspector).
 */
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
  return `<div class="narrative">${s.description}</div>${errorHtml}`
}
