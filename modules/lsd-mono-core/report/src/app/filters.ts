// Status counts and the search and status filters over the scenarios.
import type { Scenario, Status } from '../types'
import { scenarioHaystack } from '../ui/scenario-summary'
import { indexTotals, type IndexReport } from '../lib/report-index'
import { index, session, state } from './context'
export function counts() {
  if (index) return indexTotals(index)
  return session.report.scenarios.reduce(
    (acc, s) => {
      acc[s.status]++
      return acc
    },
    { success: 0, warn: 0, error: 0 } as Record<Status, number>,
  )
}

export function filtered(): Scenario[] {
  const q = state.query.trim().toLowerCase()
  // On the index page a query that matches the report's title keeps all its scenarios.
  const reportMatches = !q || (index !== null && session.report.title.toLowerCase().includes(q))
  return session.report.scenarios.filter((s) => {
    if (!state.status[s.status]) return false
    if (reportMatches) return true
    const hay = scenarioHaystack(s).toLowerCase()
    return hay.includes(q)
  })
}

export function indexEntry(id: string | null): IndexReport | undefined {
  return id ? index?.reports.find((r) => r.id === id) : undefined
}
