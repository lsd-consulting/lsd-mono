// The diagram scrolls with the page. Its stage is as tall as the whole drawing, and the
// scrollport is sticky under the top bar, at most one screen tall. The page's scroll position
// past the top of the stage is mirrored into the scrollport's scrollTop, so windowed painting,
// the sticky participant header, the minimap and focus keep working from scrollTop. When the
// diagram moves its own scrollTop (minimap, focus, section jump, zoom), the page follows.
import { diagramState } from './state'

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
    stage.style.removeProperty('--seq-port-h')
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
  // The minimap matches the scrollport's height.
  const port = `${scrollport.offsetHeight}px`
  if (stage.style.getPropertyValue('--seq-port-h') !== port) stage.style.setProperty('--seq-port-h', port)
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
