// #64: a report page written with lsd.mono.report.assets=shared carries no report of its own.
// It names its report in <meta name="lsd-report" content="<stem>">, and <stem>-report.js, loaded
// before this bundle, has added it to window.__LSD_REPORTS__. This moves it to where the rest of
// the page reads a report: window.__LSD_REPORT__ and __LSD_PAYLOADS_SRC__. A page that names a
// report whose data did not load says so, rather than showing the built-in demo.
import { REPORT_SCHEMA_VERSION, type ReportJson } from '../types'

export const SHARED_REPORT_META = 'lsd-report'

export function adoptSharedReport(win: Window = window, doc: Document = document): void {
  if (win.__LSD_REPORT__ || win.__LSD_INDEX__) return
  const stem = doc.querySelector<HTMLMetaElement>(`meta[name="${SHARED_REPORT_META}"]`)?.content
  if (!stem) return
  const data = win.__LSD_REPORTS__?.[stem]
  if (!data) {
    win.__LSD_REPORT__ = missingReport(stem)
    return
  }
  win.__LSD_REPORT__ = data.report
  if (data.payloadsSrc) win.__LSD_PAYLOADS_SRC__ = data.payloadsSrc
}

/** An empty report whose title names the data file that did not load. */
function missingReport(stem: string): ReportJson {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    title: `Report data not found: ${stem}-report.js`,
    generatedAt: '',
    generator: { name: 'lsd-mono' },
    status: 'error',
  }
}
