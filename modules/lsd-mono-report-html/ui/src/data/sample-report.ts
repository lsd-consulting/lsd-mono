import { normaliseReport } from '../lib/report-normalise'
import type { ReportJson } from '../types'
import sample from '../../../../lsd-mono-report-schema/conformance/reports/sample.json'

/**
 * Demo report: the page shows it when opened with neither a report nor an index. It is the
 * shared test report `reports/sample.json` (modules/lsd-mono-report-schema/conformance), which
 * both lsd-mono-core and the UI's tests check against the schema. Method, path, and status stay in
 * it; JSON bodies load from sample-payloads.ts when the inspector opens. It is normalised here, so
 * the page holds this very object (panel.ts knows the demo by it).
 */
export const sampleReport = normaliseReport(sample as ReportJson)
