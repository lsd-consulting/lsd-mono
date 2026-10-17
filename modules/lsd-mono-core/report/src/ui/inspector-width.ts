import { STACKED_MAX_PX } from '../lib/media'

/** Session-only. A refresh starts from the narrow column again. */
export const INSPECTOR_WIDTH_KEY = 'lsd-report-inspector-width'
/** Current narrow column, in px. Drag does not go below this floor's sibling minimum. */
export const INSPECTOR_NARROW_PX = 380
export const INSPECTOR_MIN_PX = 260

export function inspectorWidthLimits(viewport: number): { min: number; max: number; expand: number } {
  const max = Math.max(INSPECTOR_MIN_PX, Math.floor(viewport * 0.9))
  const expand = Math.min(max, Math.max(520, Math.round(viewport * 0.7)))
  return { min: INSPECTOR_MIN_PX, max, expand }
}

/** Room around a view's content: the panel's padding and a little air. */
export const INSPECTOR_VIEW_GUTTER_PX = 40

/**
 * Width that fits a component diagram or metrics view whose content is [content] px wide:
 * never narrower than the message column, and at most half the viewport so the diagram
 * beside it keeps room. A wider drawing scrolls inside the panel, or the user drags it wider.
 */
export function fitViewWidth(content: number, viewport: number): number {
  const { expand } = inspectorWidthLimits(viewport)
  const cap = Math.max(INSPECTOR_NARROW_PX, Math.min(expand, Math.round(viewport * INSPECTOR_VIEW_MAX_SHARE)))
  const want = Math.ceil(content) + INSPECTOR_VIEW_GUTTER_PX
  return clampInspectorWidth(Math.min(cap, Math.max(INSPECTOR_NARROW_PX, want)), viewport)
}

/** Share of the viewport an auto-sized view may take. */
const INSPECTOR_VIEW_MAX_SHARE = 0.5
/** Timing swim lanes and waterfall stretch to fit, so they ask for at least this much room. */
export const TIMING_VIEW_MIN_PX = 480

/** The natural width of [host]'s content, laid out without the panel's width limit. */
export function naturalWidth(host: HTMLElement): number {
  const prior = host.style.width
  host.style.width = 'max-content'
  const measured = Math.max(host.scrollWidth, host.getBoundingClientRect().width)
  host.style.width = prior
  return measured
}

export function clampInspectorWidth(px: number, viewport: number): number {
  const { min, max } = inspectorWidthLimits(viewport)
  return Math.round(Math.min(max, Math.max(min, px)))
}

export interface InspectorWidth {
  /** Current panel width in px. */
  current: () => number
  apply: (px: number) => void
  /** Size the panel to a view whose content is [content] px wide. */
  fit: (content: number) => void
  /** Back to the width saved for this session. */
  reload: () => void
}

/**
 * Panel width: the Expand/Shrink button, the drag handle and its keys, and the session copy.
 * The width lives on the shell as --inspector-w.
 */
export function bindInspectorWidth(
  doc: Document,
  parts: { panel: HTMLElement; expandBtn: HTMLButtonElement; resize: HTMLElement },
): InspectorWidth {
  const { panel, expandBtn, resize } = parts
  let width = readWidth(doc)

  const shell = (): HTMLElement | null => panel.closest('.shell')
  const viewport = (): number => doc.defaultView?.innerWidth ?? 1200

  function apply(px: number): void {
    width = clampInspectorWidth(px, viewport())
    shell()?.style.setProperty('--inspector-w', `${width}px`)
    const wide = width > INSPECTOR_NARROW_PX + 16
    shell()?.classList.toggle('inspector-json-wide', wide)
    panel.classList.toggle('inspector-json-wide', wide)
    expandBtn.setAttribute('aria-pressed', wide ? 'true' : 'false')
    expandBtn.textContent = wide ? 'Shrink' : 'Expand'
    expandBtn.setAttribute('aria-label', wide ? 'Shrink JSON' : 'Expand JSON')
    const limits = inspectorWidthLimits(viewport())
    resize.setAttribute('aria-valuemin', String(limits.min))
    resize.setAttribute('aria-valuemax', String(limits.max))
    resize.setAttribute('aria-valuenow', String(width))
  }

  /**
   * The saved width is untouched, so the next message opens at the column the user chose,
   * and a drag still resizes from here. On a phone the panel is the page width already,
   * so nothing changes.
   */
  function fit(content: number): void {
    if (viewport() <= STACKED_MAX_PX) return
    apply(fitViewWidth(content, viewport()))
  }

  function persist(): void {
    try {
      doc.defaultView?.sessionStorage.setItem(INSPECTOR_WIDTH_KEY, String(width))
    } catch {
      /* private mode or a test document without storage */
    }
  }

  expandBtn.addEventListener('click', () => {
    const wide = expandBtn.getAttribute('aria-pressed') === 'true'
    apply(wide ? INSPECTOR_NARROW_PX : inspectorWidthLimits(viewport()).expand)
    persist()
  })
  bindResize(doc, resize, { shell, width: () => width, apply, persist })

  return {
    current: () => width,
    apply,
    fit,
    reload: () => {
      width = readWidth(doc)
    },
  }
}

function readWidth(doc: Document): number {
  try {
    const raw = doc.defaultView?.sessionStorage.getItem(INSPECTOR_WIDTH_KEY)
    const parsed = raw == null ? NaN : Number(raw)
    if (!Number.isFinite(parsed)) return INSPECTOR_NARROW_PX
    return clampInspectorWidth(parsed, doc.defaultView?.innerWidth ?? 1200)
  } catch {
    return INSPECTOR_NARROW_PX
  }
}

function bindResize(
  doc: Document,
  handle: HTMLElement,
  controls: {
    shell: () => HTMLElement | null
    width: () => number
    apply: (px: number) => void
    persist: () => void
  },
): void {
  let dragging = false
  let originX = 0
  let originW = 0

  function onMove(event: PointerEvent): void {
    if (!dragging) return
    controls.apply(originW + (originX - event.clientX))
  }

  function onUp(): void {
    if (!dragging) return
    dragging = false
    controls.shell()?.classList.remove('inspector-resizing')
    controls.persist()
    doc.removeEventListener('pointermove', onMove)
    doc.removeEventListener('pointerup', onUp)
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragging = true
    originX = event.clientX
    originW = controls.width()
    controls.shell()?.classList.add('inspector-resizing')
    doc.addEventListener('pointermove', onMove)
    doc.addEventListener('pointerup', onUp)
  })

  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 80 : 24
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = controls.width() + step
    else if (event.key === 'ArrowRight') next = controls.width() - step
    else if (event.key === 'Home') next = INSPECTOR_MIN_PX
    else if (event.key === 'End') next = inspectorWidthLimits(doc.defaultView?.innerWidth ?? 1200).max
    if (next == null) return
    event.preventDefault()
    controls.apply(next)
    controls.persist()
  })
}
