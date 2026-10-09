/**
 * Keep `--topbar-h` on the root equal to the top bar's real height.
 *
 * On a wide screen the bar is one row at the token height. On a phone it wraps onto more
 * rows, and the things that sit below the sticky bar (scroll padding for in-page jumps,
 * sticky side columns) need its real height. Returns a function that stops tracking.
 */
export function trackTopbarHeight(
  bar: HTMLElement,
  root: HTMLElement = document.documentElement,
  Observer: typeof ResizeObserver | undefined = globalThis.ResizeObserver,
): () => void {
  let last = ''
  const apply = () => {
    const height = Math.ceil(bar.getBoundingClientRect().height)
    if (height <= 0) return // hidden (print) or not laid out yet: keep the token
    const value = `${height}px`
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
