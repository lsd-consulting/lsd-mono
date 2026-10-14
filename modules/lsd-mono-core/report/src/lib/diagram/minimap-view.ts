// The diagram minimap: density ticks, window marker and its pointer and keyboard binding.
import { eventHiddenByColumns } from '../diagram-view'
import { DEFAULT_VIEWPORT, HEADER_BLOCK_H } from '../layout'
import {
  densityBins,
  fractionFromPointer,
  minimapViewportRange,
  scrollTopFromMinimapFraction,
  scrubScrollTop,
} from '../minimap'
import { diagramState, diagramView } from './state'
import { syncDiagramWindow } from './viewport'

const MINIMAP_BINS = 48

/** Draw density ticks into the canvas. Bin count is fixed; event count is not. */
export function paintMinimapDensity(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = diagramState.mounted.get(id)
  const root = scrollport.closest('.seq-diagram')
  const canvas = root?.querySelector<HTMLCanvasElement>('.seq-minimap-canvas')
  if (!diagram || !canvas) return
  const view = diagramView(id)
  const track = canvas.parentElement
  const cssW = Math.max(8, track?.clientWidth || 12)
  const cssH = Math.max(32, track?.clientHeight || scrollport.clientHeight || DEFAULT_VIEWPORT)
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)
  const contentHeight = Math.max(1, diagram.height * view.zoom)
  // Only rows that are drawn: a message or note on a hidden column leaves a gap.
  const bins = densityBins(
    diagram.rows.filter((row) => !eventHiddenByColumns(row.event, view.hidden)).map((row) => row.y * view.zoom),
    contentHeight,
    MINIMAP_BINS,
  )
  const max = Math.max(1, ...bins)
  const gap = 1
  const binH = cssH / bins.length
  ctx.fillStyle = 'rgba(148, 163, 184, 0.55)'
  bins.forEach((count, index) => {
    if (!count) return
    const w = Math.max(2, (count / max) * (cssW - 2))
    ctx.fillRect(cssW - w, index * binH + gap / 2, w, Math.max(1, binH - gap))
  })
  syncMinimap(scrollport)
}

/** Move the viewport marker to match the scrollport. */
export function syncMinimap(scrollport: HTMLElement): void {
  const id = scrollport.dataset.scenarioId
  if (!id) return
  const diagram = diagramState.mounted.get(id)
  const root = scrollport.closest('.seq-diagram')
  const minimap = root?.querySelector<HTMLElement>('.seq-minimap')
  const marker = minimap?.querySelector<HTMLElement>('.seq-minimap-window')
  if (!diagram || !minimap || !marker) return
  const view = diagramView(id)
  const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
  const cssHeader = header?.offsetHeight || HEADER_BLOCK_H * view.zoom
  const contentHeight = diagram.height * view.zoom
  const range = minimapViewportRange({
    scrollTop: scrollport.scrollTop,
    viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
    headerHeight: cssHeader,
    contentHeight,
  })
  marker.style.top = `${range.top * 100}%`
  marker.style.height = `${Math.max(range.height * 100, 2)}%`
  const value = Math.round(range.top * 100)
  minimap.setAttribute('aria-valuenow', String(value))
  minimap.setAttribute('aria-valuetext', `${value}% through diagram`)
}

export function bindMinimap(diagramRoot: HTMLElement, scrollport: HTMLElement): void {
  const minimap = diagramRoot.querySelector<HTMLElement>('.seq-minimap')
  if (!minimap) return
  paintMinimapDensity(scrollport)

  const readMetrics = () => {
    const id = scrollport.dataset.scenarioId
    const diagram = id ? diagramState.mounted.get(id) : undefined
    const view = id ? diagramView(id) : undefined
    const header = scrollport.querySelector<HTMLElement>('.seq-sticky-header')
    const zoom = view?.zoom ?? 1
    return {
      headerHeight: header?.offsetHeight || HEADER_BLOCK_H * zoom,
      contentHeight: (diagram?.height ?? 0) * zoom,
      viewportHeight: scrollport.clientHeight || DEFAULT_VIEWPORT,
    }
  }

  const jumpTo = (clientY: number) => {
    const rect = minimap.getBoundingClientRect()
    const fraction = fractionFromPointer(clientY, rect.top, rect.height)
    const metrics = readMetrics()
    // Direct assignment: never an animated glide (honours reduced motion).
    scrollport.scrollTop = scrollTopFromMinimapFraction({ fractionY: fraction, ...metrics })
    syncDiagramWindow(scrollport)
  }

  let dragging = false
  minimap.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return
    dragging = true
    minimap.setPointerCapture(ev.pointerId)
    jumpTo(ev.clientY)
    ev.preventDefault()
  })
  minimap.addEventListener('pointermove', (ev) => {
    if (!dragging) return
    jumpTo(ev.clientY)
  })
  const endDrag = (ev: PointerEvent) => {
    if (!dragging) return
    dragging = false
    if (minimap.hasPointerCapture(ev.pointerId)) minimap.releasePointerCapture(ev.pointerId)
  }
  minimap.addEventListener('pointerup', endDrag)
  minimap.addEventListener('pointercancel', endDrag)

  minimap.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return
    ev.preventDefault()
    ev.stopPropagation()
    const metrics = readMetrics()
    scrollport.scrollTop = scrubScrollTop({
      scrollTop: scrollport.scrollTop,
      direction: ev.key === 'ArrowDown' ? 1 : -1,
      ...metrics,
    })
    syncDiagramWindow(scrollport)
  })
}
