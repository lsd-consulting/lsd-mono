// Bring something that just opened on screen below the sticky top bar (the narrow layout).
import { scrollBehavior } from './media'

/** Air between the sticky top bar and what is scrolled under it. */
const REVEAL_GAP_PX = 8

/**
 * On a phone the panel sits inline below the report, so what opens can land below the screen.
 * Scroll the page so it shows below the sticky top bar. With no [content] (a component diagram
 * or metrics view) that is the panel's heading. With [content] (a payload's JSON) it is the
 * heading when the heading and the start of the content fit together, else the content's own
 * row (its previous sibling). Nothing moves when it already starts on screen. Smooth unless the
 * user asks for reduced motion.
 */
export function revealBelowTopbar(panel: HTMLElement, content?: HTMLElement): void {
  const win = panel.ownerDocument.defaultView
  if (!win) return
  const bar = Number.parseFloat(getComputedStyle(panel.ownerDocument.documentElement).getPropertyValue('--topbar-h'))
  const top = (Number.isFinite(bar) ? bar : 0) + REVEAL_GAP_PX
  const room = win.innerHeight - top
  const target = (content ?? panel).getBoundingClientRect()
  const show = Math.min(target.height, room / 3)
  if (target.top >= top && target.top + show <= win.innerHeight) return
  const head = panel.getBoundingClientRect().top
  const row =
    (content?.previousElementSibling as HTMLElement | null | undefined)?.getBoundingClientRect().top ?? target.top
  const anchor = target.top + show - head <= room ? head : row
  win.scrollTo({ top: Math.max(0, win.scrollY + anchor - top), behavior: scrollBehavior() })
}
