// Reading the URL hash: open the report, scenario or message it names.
import { openReport, revealFiltered, selectScenario } from './nav'
import { defaultReportId } from '../lib/report-index'
import { parseReportHash, type HashRef } from '../lib/report-hash'
import { findMessage, focusDiagramMessage } from '../lib/sequence-diagram'
import { cssEscape } from '../lib/escape'
import { openMessage } from './panel'
import { indexEntry } from './filters'
import { index, session } from './context'
/**
 * Follow the URL hash (a link, a reload, an edited address or Back): show its scenario,
 * and open its message when it names one. Payload still loads on open.
 */
export function applyHash(): void {
  if (session.writingHash) return
  const ref = parseReportHash(window.location.hash)
  if (index) {
    const id =
      ref?.reportId && indexEntry(ref.reportId) ? ref.reportId : session.reportId ? null : defaultReportId(index)
    if (id && id !== session.reportId) {
      // The first report opens where the page starts; a later link scrolls to its scenario.
      void openReport(id, ref ?? undefined, session.booted)
      return
    }
    if (!ref || ref.reportId !== session.reportId) return
  }
  if (!ref) return
  applyRef(ref)
}

/** Show the scenario a reference names in the open report, and open its message when it names one. */
export function applyRef(ref: HashRef): void {
  const scenario = session.report.scenarios.find((item) => item.id === ref.scenarioId)
  if (!scenario) return
  // A scenario the filters hide is shown anyway: the link asked for it.
  revealFiltered(scenario.id)
  if (session.renderedId !== scenario.id) selectScenario(scenario.id)
  if (!ref.messageId) return
  const msg = findMessage(scenario, ref.messageId)
  if (!msg) return
  const already =
    session.inspector?.isOpen() &&
    session.invoker?.scenarioId === ref.scenarioId &&
    session.invoker?.messageId === ref.messageId
  requestAnimationFrame(() => {
    const scroll = document.querySelector<HTMLElement>(`#card-${cssEscape(scenario.id)} .seq-scroll`)
    if (scroll) focusDiagramMessage(scroll, msg.id)
    if (!already) openMessage(scenario, msg)
  })
}
