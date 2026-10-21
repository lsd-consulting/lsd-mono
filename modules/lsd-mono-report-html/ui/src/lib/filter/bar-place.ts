// Where a participant header's Hide and More bar opens (#92): just under its header, or above it
// when the window has no room for it below (a header near the bottom of the window), so it never
// opens off screen. The scrollport clips anything above the header, so a bar above is placed
// against the window (position: fixed) at the left it would have had, kept inside the scrollport.

/** Space between the header and its bar, as participant-filter.css draws it below. */
export const BAR_GAP_PX = 2

interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * Where the bar goes for a header at [head] (window px) in a window [viewHeight] tall, with the
 * top bar's bottom at [ceiling] and the scrollport at [port]: null below the header (it fits
 * there, or it would not fit above either), else the bar's fixed top and left.
 */
export function barAbove(
  head: Box,
  bar: { width: number; height: number; offsetLeft: number },
  viewHeight: number,
  ceiling: number,
  port: Box,
): { top: number; left: number } | null {
  if (viewHeight - head.bottom >= bar.height + BAR_GAP_PX) return null
  const top = head.top - BAR_GAP_PX - bar.height
  if (top < ceiling) return null
  const left = Math.min(Math.max(head.left + bar.offsetLeft, port.left), port.right - bar.width)
  return { top, left }
}

/** Put [head]'s [bar] below it, or above it when the window has no room below. */
export function placeBar(head: HTMLElement, bar: HTMLElement): void {
  const doc = head.ownerDocument
  const win = doc.defaultView
  if (!win) return
  head.removeAttribute('data-bar-above')
  const port = head.closest('.seq-scroll')?.getBoundingClientRect() ?? head.getBoundingClientRect()
  const ceiling = doc.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0
  const pillX = Number.parseFloat(win.getComputedStyle(head).getPropertyValue('--pill-x')) || 0
  const place = barAbove(
    head.getBoundingClientRect(),
    { width: bar.offsetWidth, height: bar.offsetHeight, offsetLeft: pillX },
    win.innerHeight,
    ceiling,
    port,
  )
  if (!place) return
  bar.style.setProperty('--bar-top', `${Math.round(place.top)}px`)
  bar.style.setProperty('--bar-left', `${Math.round(place.left)}px`)
  head.setAttribute('data-bar-above', '')
}

/** Whether [head]'s bar is showing: hovered, tapped open, or holding keyboard focus. */
export function barShown(head: HTMLElement): boolean {
  return head.matches(':hover') || head.hasAttribute('data-revealed') || head.contains(head.ownerDocument.activeElement)
}
