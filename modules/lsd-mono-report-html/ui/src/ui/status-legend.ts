// What Success, Warn and Error mean (#163): the legend by the status chips, and a Warn scenario's reason.
import { escapeHtml } from '../lib/escape'
import type { Scenario, Status } from '../types'
import { statusLabel } from './format'

/**
 * One plain sentence per status, from the rules the integrations follow (lsd-mono-jvm's Status,
 * the JUnit extension, the Cucumber plugin and the Spring test lifecycle).
 */
export const STATUS_DEFINITIONS: Record<Status, string> = {
  success: 'The test passed.',
  warn:
    'The test neither passed nor failed, so it is not counted as a failure: it was disabled or aborted ' +
    '(for example an assumption failed), a Cucumber step was skipped, pending, undefined or ambiguous, ' +
    'or it was still running when the report was written.',
  error: 'The test failed: an assertion failed or an exception was thrown.',
}

/** The id of a status's definition, for `aria-describedby` on the chips and the scenario badge. */
export function statusDefinitionId(s: Status): string {
  return `status-def-${s}`
}

/** What lsd-mono-jvm writes as the description of a scenario the report closed (NOT_COMPLETED_NOTE). */
const NOT_COMPLETED = 'Scenario was not completed before the report was written.'

/** Cucumber's error headlines for a Warn result, and what each one means. */
const CUCUMBER_REASONS: Record<string, string> = {
  Skipped: 'a step was skipped',
  Pending: 'a step is pending',
  'Undefined step': 'a step is undefined',
  'Ambiguous step': 'a step matches more than one step definition',
}

/**
 * Why a Warn scenario is Warn, when what the integrations wrote says so; null when it does not
 * (a status set by hand, say). Only Warn scenarios have one.
 */
export function warnReason(s: Pick<Scenario, 'status' | 'description' | 'error'>): string | null {
  if (s.status !== 'warn') return null
  if (s.description.startsWith(NOT_COMPLETED)) return 'it was still running when the report was written'
  if (/^Test disabled\b/.test(s.description)) return 'the test is disabled'
  const headline = s.error?.headline ?? ''
  const message = s.error?.message ?? ''
  if (headline === 'Test aborted' || headline.startsWith('Aborted')) {
    return /assumption/i.test(`${headline} ${message}`)
      ? 'an assumption failed, so the test was aborted rather than failed'
      : 'the test was aborted rather than failed'
  }
  return CUCUMBER_REASONS[headline] ?? null
}

/** The legend's disclosure button and its panel. The panel's definitions back aria-describedby. */
export function statusLegendHtml(): string {
  const items = (['success', 'warn', 'error'] as Status[])
    .map(
      (s) =>
        `<dt><span class="badge ${s}">${escapeHtml(statusLabel(s))}</span></dt><dd id="${statusDefinitionId(s)}">${escapeHtml(STATUS_DEFINITIONS[s])}</dd>`,
    )
    .join('')
  return `<button type="button" class="chip legend-btn" id="btn-status-legend" aria-expanded="false" aria-controls="status-legend" aria-label="What the statuses mean">?</button>
      <div class="status-legend" id="status-legend" role="region" aria-labelledby="status-legend-title" hidden>
        <h2 class="status-legend-title" id="status-legend-title">What the statuses mean</h2>
        <dl>${items}</dl>
      </div>`
}

/** The one line a Warn scenario's description shows, when the reason is known. */
export function warnReasonHtml(s: Scenario): string {
  const reason = warnReason(s)
  return reason ? `<p class="warn-reason">Marked Warn because: ${escapeHtml(reason)}.</p>` : ''
}
