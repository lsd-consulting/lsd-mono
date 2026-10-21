/** Air kept above the search row once the bar's first row has scrolled away. */
const LEAD_KEEP_PX = 8

/**
 * How far the bar may scroll up before it sticks: on a phone the bar wraps, and its first row
 * (brand, theme, help) scrolls away so only the search row stays. Zero when search is on the
 * first row (a wide screen).
 */
export function stickyLead(barTop: number, searchTop: number): number {
  const lead = Math.round(searchTop - barTop - LEAD_KEEP_PX)
  return lead > LEAD_KEEP_PX ? lead : 0
}

/**
 * Keep `--topbar-h` on the root equal to the height of the bar while it sticks.
 *
 * On a wide screen the bar is one row at the token height. On a phone it wraps onto two rows;
 * its sticky `top` is set to minus the first row ([stickyLead]), so scrolling slides that row
 * away with the page (no class flip, no layout jump, no animation to reduce) and only search and
 * the status chips stay. The things that sit below the sticky bar (the diagram toolbar, the
 * panel heading, scroll padding for in-page jumps and reveals) use that stuck height.
 * Returns a function that stops tracking.
 */
export function trackTopbarHeight(
  bar: HTMLElement,
  root: HTMLElement = document.documentElement,
  Observer: typeof ResizeObserver | undefined = globalThis.ResizeObserver,
): () => void {
  let last = ''
  const apply = () => {
    const rect = bar.getBoundingClientRect()
    const height = Math.ceil(rect.height)
    if (height <= 0) return // hidden (print) or not laid out yet: keep the token
    const search = bar.querySelector('.search-wrap')
    // Measure from where the bar would sit unstuck, so a scrolled page gives the same answer.
    const lead = search ? stickyLead(bar.offsetTop, bar.offsetTop + (search as HTMLElement).offsetTop) : 0
    bar.style.top = lead ? `-${lead}px` : ''
    const value = `${height - lead}px`
    if (value === last) return
    last = value
    root.style.setProperty('--topbar-h', value)
  }
  apply()
  if (!Observer) return () => {}
  const observer = new Observer(apply)
  observer.observe(bar)
  return () => observer.disconnect()
}

/**
 * Keep [prop] on [target] equal to [el]'s height, so CSS can make room for a sticky part whose
 * height depends on its content (the side panel's head, #116). Skipped while [el] is hidden, so
 * the CSS fallback stays. Returns a function that stops tracking.
 */
export function trackHeightVar(
  el: HTMLElement,
  target: HTMLElement,
  prop: string,
  Observer: typeof ResizeObserver | undefined = globalThis.ResizeObserver,
): () => void {
  const apply = () => {
    const height = Math.ceil(el.getBoundingClientRect().height)
    if (height > 0) target.style.setProperty(prop, `${height}px`)
  }
  apply()
  if (!Observer) return () => {}
  const observer = new Observer(apply)
  observer.observe(el)
  return () => observer.disconnect()
}
