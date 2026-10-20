// Printing: every row painted and the drawing cut into page slices, then put back afterwards.
import { addPrintSlices, removePrintSlices } from './print-slices'
import { diagramState } from './state'
import { syncDiagramWindow } from './window'

export function ensurePrintHooks(): void {
  if (diagramState.printHooks || typeof window === 'undefined') return
  diagramState.printHooks = true
  const repaint = () => {
    document.querySelectorAll<HTMLElement>('.seq-scroll').forEach((el) => syncDiagramWindow(el))
  }
  const diagrams = () => document.querySelectorAll<HTMLElement>('.seq-diagram')
  window.addEventListener('beforeprint', () => {
    diagramState.printAllRows = true
    repaint()
    diagrams().forEach((diagram) => addPrintSlices(diagram))
  })
  window.addEventListener('afterprint', () => {
    diagrams().forEach((diagram) => removePrintSlices(diagram))
    diagramState.printAllRows = false
    repaint()
  })
}
