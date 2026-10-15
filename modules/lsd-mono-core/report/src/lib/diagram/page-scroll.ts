// The diagram scrolls with the page. Its stage is as tall as the whole drawing, and the
// scrollport is sticky under the top bar, at most one screen tall. The page's scroll position
// past the top of the stage is mirrored into the scrollport's scrollTop, so windowed painting,
// the sticky participant header and focus keep working from scrollTop. When the
// diagram moves its own scrollTop (focus, section jump, zoom), the page follows.
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
function linked(scrollport: HTMLElement): boolean {
  return scrollport.isConnected && !diagramState.printAllRows && getComputedStyle(scrollport).position === 'sticky'
}

/** The scrollTop the page position asks for, clamped to what the scrollport can scroll. */
function pageScrollTop(scrollport: HTMLElement, stage: HTMLElement): number {
  const max = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight)
  const past = stickyTop(scrollport) - stage.getBoundingClientRect().top
  return Math.min(max, Math.max(0, past))
}

/** Make the stage as tall as the drawing, so the page can scroll through all of it. */
export function sizeStage(scrollport: HTMLElement): void {
  const stage = stageOf(scrollport)
  if (!stage) return
  if (!linked(scrollport)) {
    stage.style.removeProperty('height')
    return
  }
  const height = `${scrollport.scrollHeight + (scrollport.offsetHeight - scrollport.clientHeight)}px`
  if (stage.style.height !== height) stage.style.height = height
  // The scrollport sticks below the toolbar while the toolbar sticks (not on a phone).
  const diagram = stage.closest<HTMLElement>('.seq-diagram')
  const toolbar = diagram?.querySelector<HTMLElement>('.seq-toolbar')
  const bar = toolbar && getComputedStyle(toolbar).position === 'sticky' ? `${toolbar.offsetHeight}px` : '0px'
  if (diagram && diagram.style.getPropertyValue('--seq-toolbar-h') !== bar)
    diagram.style.setProperty('--seq-toolbar-h', bar)
}

/**
 * Page positions this module asked for. The page scroll they cause must not be written back
 * into the scrollport: that would cancel a smooth scroll the diagram is still running.
 */
const led = new WeakMap<HTMLElement, number>()

/** Page scrolled: carry it into the scrollport. */
function followPage(scrollport: HTMLElement): void {
  const stage = stageOf(scrollport)
  if (!stage || !linked(scrollport)) return
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
  followPage(scrollport)
}

const scrollports = new Set<HTMLElement>()
let listening = false

function onPageScroll(): void {
  for (const scrollport of scrollports) {
    if (!scrollport.isConnected) scrollports.delete(scrollport)
    else followPage(scrollport)
  }
}

/** Link one diagram's scrollport to the page scroll. Safe to call again after a re-render. */
export function bindPageScroll(scrollport: HTMLElement): void {
  if (typeof window === 'undefined') return
  scrollports.add(scrollport)
  if (!listening) {
    listening = true
    window.addEventListener('scroll', onPageScroll, { passive: true })
    window.addEventListener('resize', onPageScroll, { passive: true })
  }
  scrollport.addEventListener('scroll', () => leadPage(scrollport), { passive: true })
  sizeStage(scrollport)
  followPage(scrollport)
}
