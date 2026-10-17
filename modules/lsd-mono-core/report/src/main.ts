import './styles/app.css'
import './styles/timing.css'
import './styles/diagram.css'
import { onKey } from './app/keys'
import { paintThemeButton, renderShell } from './app/chrome'
import { applyHash } from './app/routing'
import type { Report } from './types'
import { type IndexManifest, type ReportData } from './lib/report-index'
import { syncDiagramWindow } from './lib/sequence-diagram'
import { applyTheme, followOsTheme, getPreferredTheme } from './ui/theme'
import { index, session } from './app/context'

declare global {
  interface Window {
    /** Set by lsd-mono-core ReportWriter before this bundle boots. Dev: assign before load to preview a capture. */
    __LSD_REPORT__?: Report
    /** Full message payloads, loaded when the inspector opens. Not part of the first paint. */
    __LSD_PAYLOADS__?: Record<string, unknown>
    /** Sibling script that assigns `__LSD_PAYLOADS__`. Relative to the report HTML. */
    __LSD_PAYLOADS_SRC__?: string
    /** Set on the index page instead of `__LSD_REPORT__`: every report in the directory. */
    __LSD_INDEX__?: IndexManifest
    /** Filled by each `<stem>-report.js` as the index page opens reports. */
    __LSD_REPORTS__?: Record<string, ReportData>
  }
}

// The head script already set it before first paint; this keeps the two in step.
applyTheme(getPreferredTheme())
followOsTheme((theme) => paintThemeButton({ mode: 'auto', theme }))
if (index) document.title = index.title
renderShell()
applyHash()
session.booted = true
window.addEventListener('hashchange', () => applyHash())
window.addEventListener('keydown', onKey)
window.addEventListener('resize', () => {
  document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => {
    syncDiagramWindow(el)
  })
})
