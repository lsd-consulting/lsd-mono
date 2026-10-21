// The diagram scrolls with the page. Its stage is as tall as the whole drawing, and the
// scrollport is sticky under the top bar, at most one screen tall. The page's scroll position
// past the top of the stage is mirrored into the scrollport's scrollTop, so windowed painting,
// the sticky participant header and focus keep working from scrollTop. When the
// diagram moves its own scrollTop (focus, section jump, zoom), the page follows.
import { isPhone, isStacked } from '../media'
import { stickyLead } from '../topbar-height'
import { diagramState, diagramView } from './state'

/** Distance between the page's position past the stage top and the scrollport's scrollTop. */
const TOLERANCE_PX = 1

function stageOf(scrollport: HTMLElement): HTMLElement | null {
  return scrollport.closest<HTMLElement>('.seq-stage')
}

function stickyTop(scrollport: HTMLElement): number {
  const top = Number.parseFloat(getComputedStyle(scrollport).top)
  return Number.isFinite(top) ? top : 0
}

/** Linked while the stage is laid out as a page-height block (not in print, not detached). */
/** Whether the diagram scrolls with the page (its sticky scrollport follows the page scroll). */
export function scrollsWithPage(scrollport: HTMLElement): boolean {
  return linked(scrollport)
}

function linked(scrollport: HTMLElement): boolean {
  return scrollport.isConnected && !diagramState.printAllRows && getComputedStyle(scrollport).position === 'sticky'
}

/** The scrollTop the page position asks for, clamped to what the scrollport can scroll. */
function pageScrollTop(scrollport: HTMLElement, stage: HTMLElement): number {
  const max = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight)
  const past = stickyTop(scrollport) - stage.getBoundingClientRect().top
  return Math.min(max, Math.max(0, past))
}

/** Not drawn: its view is hidden behind the Components tab (#105), which keeps its place for it. */
function undrawn(scrollport: HTMLElement): boolean {
  return scrollport.getClientRects().length === 0
}

/** Make the stage as tall as the drawing, so the page can scroll through all of it. */
export function sizeStage(scrollport: HTMLElement): void {
  const stage = stageOf(scrollport)
  if (!stage || undrawn(scrollport)) return
  if (!linked(scrollport)) {
    stage.style.removeProperty('height')
    return
  }
  const height = `${scrollport.scrollHeight + (scrollport.offsetHeight - scrollport.clientHeight)}px`
  if (stage.style.height !== height) stage.style.height = height
  // The scrollport sticks below the toolbar while the toolbar sticks. On a phone only the
  // toolbar's last row (Find) stays stuck; the rows above it scroll away (the lead).
  const diagram = stage.closest<HTMLElement>('.seq-diagram')
  const toolbar = diagram?.querySelector<HTMLElement>('.seq-toolbar')
  if (!diagram) return
  const sticky = toolbar != null && getComputedStyle(toolbar).position === 'sticky'
  // The Find row's top is its tallest item's top (the field or the step buttons).
  const row = [...(toolbar?.querySelectorAll<HTMLElement>('.diagram-find, .find-steps') ?? [])]
  const rowTop = row.length ? Math.min(...row.map((el) => el.offsetTop)) : null
  const lead = sticky && rowTop != null && isPhone() ? stickyLead(0, rowTop) : 0
  const bar = sticky ? `${toolbar.offsetHeight - lead}px` : '0px'
  if (diagram.style.getPropertyValue('--seq-toolbar-h') !== bar) diagram.style.setProperty('--seq-toolbar-h', bar)
  const leadPx = `${lead}px`
  if (diagram.style.getPropertyValue('--seq-toolbar-lead') !== leadPx)
    diagram.style.setProperty('--seq-toolbar-lead', leadPx)
  // What the page holds below the stage (panel padding, margins). The scrollport cannot stick
  // there, so at the end of the page it is carried up by that much and its top, with the
  // participant header, slides under the bars (#80). Phones only: a desktop keeps the
  // full-height scrollport it has always had.
  // An open inspector stacks under the report on a phone and is not part of that room, so
  // while it is open the last measure stands.
  if (!document.querySelector('.with-inspector')) roomBelow.set(diagram, isPhone() ? belowStage(stage) : 0)
  fitBelow(stage, diagram)
}

/** The room under each diagram's stage that its scrollport leaves out at the end of the page. */
const roomBelow = new WeakMap<HTMLElement, number>()

/**
 * Leave out of the scrollport's height only the part of the room below the stage that is on
 * screen, so it fits between the bars and the stage's end and stays stuck to the last scroll
 * position (#80). That is none of it while the page has the room still to scroll, and all of it
 * at the page end: until the last of the room comes up, the drawing fills the screen (#113).
 * Run on every page scroll, before the scrollport follows it, so its scrollTop is clamped to
 * the height it is about to have.
 */
function fitBelow(stage: HTMLElement, diagram: HTMLElement): void {
  const room = roomBelow.get(diagram) ?? 0
  const shown = room > 0 ? Math.ceil(window.innerHeight - stage.getBoundingClientRect().bottom) : 0
  const below = `${Math.min(room, Math.max(0, shown))}px`
  if (diagram.style.getPropertyValue('--seq-below') !== below) diagram.style.setProperty('--seq-below', below)
}

/** Page scrolled: fit the scrollport to the room below the stage that has come up. */
function fitToPage(scrollport: HTMLElement): void {
  const stage = stageOf(scrollport)
  const diagram = stage?.closest<HTMLElement>('.seq-diagram')
  if (!stage || !diagram || !linked(scrollport) || undrawn(scrollport)) return
  fitBelow(stage, diagram)
}

/** Page height under the stage's bottom edge, in CSS pixels. */
function belowStage(stage: HTMLElement): number {
  const stageBottom = stage.getBoundingClientRect().bottom + window.scrollY
  return Math.max(0, Math.round(document.documentElement.scrollHeight - stageBottom))
}

/**
 * Page positions this module asked for. The page scroll they cause must not be written back
 * into the scrollport: that would cancel a smooth scroll the diagram is still running.
 */
const led = new WeakMap<HTMLElement, number>()

/** Page scrolled: carry it into the scrollport. */
function followPage(scrollport: HTMLElement): void {
  const stage = stageOf(scrollport)
  if (!stage || !linked(scrollport) || undrawn(scrollport)) return
  const asked = led.get(scrollport)
  led.delete(scrollport)
  if (asked !== undefined && Math.abs(window.scrollY - asked) <= TOLERANCE_PX) return
  const want = pageScrollTop(scrollport, stage)
  if (Math.abs(scrollport.scrollTop - want) > TOLERANCE_PX) scrollport.scrollTop = want
}

/** The diagram moved its own scrollTop: scroll the page by the same amount. */
function leadPage(scrollport: HTMLElement): void {
  const stage = stageOf(scrollport)
  if (!stage || !linked(scrollport)) return
  // Stacked (860px and below), an open inspector sits in the page under the report, and the page
  // scrolls to it (the Accuracy chip to Accuracy by pair, a tapped arrow to its JSON). The
  // scrollport follows that scroll as it passes the stage; leading the page back from those
  // scrolls cancelled a smooth scroll to the panel halfway (#95), so the page leads alone then.
  if (isStacked() && document.querySelector('.with-inspector')) return
  const delta = scrollport.scrollTop - pageScrollTop(scrollport, stage)
  if (Math.abs(delta) <= TOLERANCE_PX) return
  const top = window.scrollY + delta
  led.set(scrollport, top)
  window.scrollTo({ top, behavior: 'instant' })
}

/**
 * Bring a row of the drawing to the top of the diagram: `y` is the row's top in drawing pixels
 * (the section jump list). The diagram scrolls with the page, so this moves the page: the stage
 * goes up by `y` at the current zoom, and the scrollport follows. Setting the scrollport's
 * scrollTop alone does nothing when the whole drawing fits on screen (it has nothing to scroll),
 * and the page would put it back anyway.
 */
export function scrollDiagramTo(scrollport: HTMLElement, y: number): void {
  scrollDiagramToOffset(scrollport, y * diagramView(scrollport.dataset.scenarioId ?? '').zoom)
}

/**
 * Bring a point `offset` CSS pixels below the participant header (the scrollTop that would show
 * it at the top) to the top of the diagram. Moves the page when the diagram scrolls with it.
 */
export function scrollDiagramToOffset(scrollport: HTMLElement, offset: number): void {
  const stage = stageOf(scrollport)
  if (!stage || !linked(scrollport)) {
    scrollport.scrollTop = offset
    return
  }
  const top = Math.max(0, window.scrollY + stage.getBoundingClientRect().top - stickyTop(scrollport) + offset)
  window.scrollTo({ top, behavior: 'instant' })
  // Fitted to the page position it has now, so it follows to a scrollTop it can reach.
  fitToPage(scrollport)
  followPage(scrollport)
}

/**
 * Scroll the page just enough that [el], in the drawing, is wholly on screen: below the sticky
 * header, above the window's bottom and the scrollport's, with [clearance] px to spare (#113).
 * The drawing scrolls with the page, so this moves both at once. Returns whether it moved.
 */
export function keepOnPage(scrollport: HTMLElement, el: HTMLElement, clearance: number): boolean {
  if (!linked(scrollport) || undrawn(scrollport)) return false
  const box = el.getBoundingClientRect()
  const port = scrollport.getBoundingClientRect()
  const top = scrollport.querySelector('.seq-sticky-header')?.getBoundingClientRect().bottom ?? port.top
  const bottom = Math.min(window.innerHeight, port.bottom)
  let by = 0
  if (box.bottom > bottom + TOLERANCE_PX) by = box.bottom - bottom + clearance
  else if (box.top < top - TOLERANCE_PX) by = box.top - top - clearance
  if (by === 0) return false
  window.scrollTo({ top: Math.max(0, window.scrollY + by), behavior: 'instant' })
  fitToPage(scrollport)
  followPage(scrollport)
  return true
}

/**
 * How much of the scrollport's height is on screen, in CSS pixels. Until the diagram sticks its
 * top is lower on the page than the sticky line, so its lower part can be below the window (#113).
 */
export function shownHeight(scrollport: HTMLElement): number {
  if (!linked(scrollport)) return scrollport.clientHeight
  const onScreen = window.innerHeight - scrollport.getBoundingClientRect().top
  return Math.max(0, Math.min(scrollport.clientHeight, Math.floor(onScreen)))
}

const scrollports = new Set<HTMLElement>()
let listening = false

function onPageScroll(): void {
  for (const scrollport of scrollports) {
    if (!scrollport.isConnected) scrollports.delete(scrollport)
    else {
      fitToPage(scrollport)
      followPage(scrollport)
    }
  }
}

/** The window changed size: what sits below a stage may have rewrapped. */
function onPageResize(): void {
  for (const scrollport of scrollports) if (scrollport.isConnected) sizeStage(scrollport)
}

const watchedToolbars = new WeakSet<HTMLElement>()

/** The toolbar rewraps (the hidden-participants chip comes and goes): its stuck height and lead change. */
function watchToolbar(scrollport: HTMLElement): void {
  const toolbar = scrollport.closest('.seq-diagram')?.querySelector<HTMLElement>('.seq-toolbar')
  if (!toolbar || watchedToolbars.has(toolbar) || typeof ResizeObserver === 'undefined') return
  watchedToolbars.add(toolbar)
  new ResizeObserver(() => {
    if (scrollport.isConnected) sizeStage(scrollport)
  }).observe(toolbar)
}

/** Link one diagram's scrollport to the page scroll. Safe to call again after a re-render. */
export function bindPageScroll(scrollport: HTMLElement): void {
  if (typeof window === 'undefined') return
  scrollports.add(scrollport)
  if (!listening) {
    listening = true
    window.addEventListener('scroll', onPageScroll, { passive: true })
    window.addEventListener('resize', onPageScroll, { passive: true })
    window.addEventListener('resize', onPageResize, { passive: true })
  }
  scrollport.addEventListener('scroll', () => leadPage(scrollport), { passive: true })
  watchToolbar(scrollport)
  sizeStage(scrollport)
  followPage(scrollport)
}
