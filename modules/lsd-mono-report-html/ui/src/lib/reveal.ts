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

/**
 * Scroll [scroller] sideways just enough that [el] is wholly inside it. A browser leaves a control
 * that is partly in view where it is when it takes focus, so its far edge, and the focus ring
 * drawn there, stayed cut off (#116: the phone's row of timing chips). A control wider than the
 * scroller lines up with its start.
 */
export function revealSideways(scroller: HTMLElement, el: Element): void {
  const box = scroller.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  let delta = 0
  if (r.left < box.left) delta = r.left - box.left
  else if (r.right > box.right) delta = Math.min(r.right - box.right, r.left - box.left)
  if (delta) scroller.scrollLeft += delta
}
