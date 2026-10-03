import type { Insight } from '../types'
import { truncateLabel } from './format'
import { escapeHtml } from './scenario-summary'

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Ranked duration list. Rank number and kind word are the cues — no colour-only status.
 * Returns empty when there is nothing to show (metrics disabled or no durations).
 */
export function insightsListHtml(insights: Insight[] | undefined, labelMaxWidth: number): string {
  if (!insights?.length) return ''
  const items = insights
    .map((insight) => {
      const kind = insight.kind === 'bottleneck' ? 'bottleneck' : 'slowest'
      const duration =
        insight.kind === 'bottleneck'
          ? `${insight.isolatedMs} ms isolated (total ${insight.totalMs} ms)`
          : `${insight.totalMs} ms`
      const shown = truncateLabel(insight.label, labelMaxWidth)
      return `<li>
        <span class="insight-rank">#${insight.rank}</span>
        <span class="insight-kind">${escapeHtml(kind)}</span>
        <span class="insight-who">${escapeHtml(insight.participant)}</span>
        <span class="insight-dur">${escapeHtml(duration)}</span>
        <span class="insight-label" title="${escapeAttr(insight.label)}">${escapeHtml(shown)}</span>
        <button type="button" class="text-btn" data-show-message="${escapeAttr(insight.messageId)}">show</button>
      </li>`
    })
    .join('')
  return `<ol class="insights" aria-label="Duration insights">${items}</ol>`
}
