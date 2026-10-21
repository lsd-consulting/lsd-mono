// The Zoom group in the diagram toolbar (#94): [−] [N%] [+] [Overview], and keeping the readout,
// the limits and the Overview button in step with the view. What they do is in zoom-controls.ts
// for the sequence diagram and component-zoom.ts for the Components view (#105).
import { frameOf } from './geometry'
import { type DiagramView, diagramState, diagramView } from './state'
import { canStepZoom, overviewNeeded, zoomLabel } from '../diagram-view'
import { escapeAttr, escapeHtml } from '../escape'

const ICON =
  'class="zoom-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"'

const minusSvg = `<svg ${ICON} stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>`

const plusSvg = `<svg ${ICON} stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`

/**
 * Lucide "scan" (https://lucide.dev/icons/scan): ISC License, Copyright (c) 2026 Lucide Icons and
 * Contributors. The full notice is in THIRD-PARTY-NOTICES.md at the repository root. (No comment
 * in the markup: the single-file report cannot hold "<!--" in its inline script.)
 */
const scanSvg = `<svg ${ICON} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>`

const OVERVIEW_TITLE = 'Overview: whole diagram (Shift+1)'

const OVERVIEW_FITS_TITLE = 'Whole diagram already fits'

function readoutName(zoom: number): string {
  return `Reset zoom, now ${zoomLabel(zoom)}`
}

function disabledAttr(disabled: boolean): string {
  return disabled ? ' aria-disabled="true"' : ''
}

/** A view's zoom, as its Zoom group shows it. */
export interface ZoomShown {
  zoom: number
  overview: boolean
}

/** The zoom and Overview of a sequence diagram's view. */
export function sequenceZoomShown(view: DiagramView): ZoomShown {
  return { zoom: view.zoom, overview: view.mode.kind === 'overview' }
}

/** The Zoom group in a diagram toolbar. paintZoomControls keeps it up to date. */
export function zoomControlsHtml({ zoom, overview }: ZoomShown): string {
  return `<div class="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" class="zoom-btn" data-zoom="out" aria-label="Zoom out" title="Zoom out (−)"${disabledAttr(!canStepZoom(zoom, -1))}>${minusSvg}</button>
        <button type="button" class="zoom-readout" data-zoom="reset" aria-label="${escapeAttr(readoutName(zoom))}" title="Reset to default zoom (0)">${escapeHtml(zoomLabel(zoom))}</button>
        <button type="button" class="zoom-btn" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)"${disabledAttr(!canStepZoom(zoom, 1))}>${plusSvg}</button>
        <button type="button" class="zoom-btn zoom-overview" data-zoom="overview" aria-label="Overview" aria-pressed="${overview}" title="${escapeAttr(OVERVIEW_TITLE)}">${scanSvg}<span class="zoom-overview-label" aria-hidden="true">Overview</span></button>
      </div>`
}

function setDisabled(btn: Element | null, disabled: boolean): void {
  if (!btn) return
  if (disabled) btn.setAttribute('aria-disabled', 'true')
  else btn.removeAttribute('aria-disabled')
}

/**
 * Paint a Zoom [group]: the readout, the limits of − and +, and whether Overview is on or, when
 * [useful] is false, has nothing to show.
 */
export function paintZoomControls(group: Element, shown: ZoomShown, useful: boolean): void {
  const readout = group.querySelector('[data-zoom="reset"]')
  if (readout) {
    readout.textContent = zoomLabel(shown.zoom)
    readout.setAttribute('aria-label', readoutName(shown.zoom))
  }
  setDisabled(group.querySelector('[data-zoom="out"]'), !canStepZoom(shown.zoom, -1))
  setDisabled(group.querySelector('[data-zoom="in"]'), !canStepZoom(shown.zoom, 1))
  const overview = group.querySelector('[data-zoom="overview"]')
  if (!overview) return
  const enabled = shown.overview || useful
  overview.setAttribute('aria-pressed', String(shown.overview))
  setDisabled(overview, !enabled)
  overview.setAttribute('title', enabled ? OVERVIEW_TITLE : OVERVIEW_FITS_TITLE)
}

/** The sequence diagram's Zoom group, from its view. */
export function syncZoomControls(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  const diagram = id ? diagramState.mounted.get(id) : undefined
  const group = scrollport.closest('.seq-diagram')?.querySelector('.zoom-controls')
  if (!id || !diagram || !group) return
  const view = diagramView(id)
  // Unmeasured (a collapsed card) counts as fitting: there is nothing to show yet.
  paintZoomControls(
    group,
    sequenceZoomShown(view),
    overviewNeeded(frameOf(diagram, view.hidden).total, scrollport.clientWidth),
  )
}
