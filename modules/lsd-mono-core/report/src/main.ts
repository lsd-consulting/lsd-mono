import './styles/app.css'
import './styles/timing.css'
import './styles/diagram.css'
import { listenForKeys } from './app/keys'
import { renderShell } from './app/chrome'
import { applyHash } from './app/routing'
import type { ReportJson } from './types'
import { type IndexManifest, type ReportDataJson } from './lib/report-index'
import { syncDiagramWindow } from './lib/sequence-diagram'
import { applyTheme, followOsTheme, followOtherTabs, forgetLegacyTheme, getPreferredTheme } from './ui/theme'
import { paintThemeControl } from './ui/theme-menu'
import { app, index, session, unreadable } from './app/context'
import { upgradeHtml } from './lib/schema-version'
import { pingSource, usage } from './lib/usage-ping'

declare global {
  interface Window {
    /** Set by lsd-mono-core ReportWriter before this bundle boots. Dev: assign before load to preview a capture. */
    __LSD_REPORT__?: ReportJson
    /** Full message payloads, loaded when the inspector opens. Not part of the first paint. */
    __LSD_PAYLOADS__?: Record<string, unknown>
    /** What the payload script assigns: each payload's JSON text, parsed when it is read. */
    __LSD_PAYLOAD_TEXT__?: Record<string, string>
    /** Sibling script that assigns `__LSD_PAYLOAD_TEXT__`. Relative to the report HTML. */
    __LSD_PAYLOADS_SRC__?: string
    /** Set on the index page instead of `__LSD_REPORT__`: every report in the directory. */
    __LSD_INDEX__?: IndexManifest
    /** Filled by each `<stem>-report.js` as the index page opens reports. */
    __LSD_REPORTS__?: Record<string, ReportDataJson>
  }
}

// The head script already set it before first paint; this keeps the two in step.
forgetLegacyTheme()
applyTheme(getPreferredTheme())
followOsTheme((theme) => paintThemeControl({ mode: 'auto', theme }))
followOtherTabs(paintThemeControl)
if (unreadable) showUpgradePage(unreadable)
else boot()

/** The page: the shell, the report or index in it, and what keeps them up to date. */
function boot(): void {
  if (index) document.title = index.title
  renderShell()
  applyHash()
  session.booted = true
  // After first render. A page with neither a report nor an index (the built-in demo) never pings.
  // The report as the page holds it (normalised, so its options are filled in), or the index.
  usage.configure(window.__LSD_REPORT__ ? session.report : index)
  usage.ping('report-open')
  if (window.__LSD_REPORT__) pingSource(session.report)
  window.addEventListener('hashchange', () => applyHash())
  listenForKeys(document)
  window.addEventListener('resize', () => {
    document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => {
      syncDiagramWindow(el)
    })
  })
}

/** A report or index of a newer major version: say so, and do nothing else (it never pings). */
function showUpgradePage(fit: NonNullable<typeof unreadable>): void {
  document.title = `Upgrade lsd-mono · LSD ${fit.what}`
  app.innerHTML = `<main class="main schema-upgrade-page" id="main">${upgradeHtml(fit, fit.what)}</main>`
}
