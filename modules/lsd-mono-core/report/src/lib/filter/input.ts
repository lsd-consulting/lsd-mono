// Document-wide input the participant filter reads: the last input (a press, or a key), and one
// outside-press listener for every diagram.

/**
 * The page's last input, per document: a press (and where), or a key. Tracked on the document in
 * the capture phase, so a key pressed outside a header (Tab into it) counts, and so a press on a
 * header's name, which never moves focus into it, is forgotten at the next key. Any keydown
 * counts, even a lone Shift: the header stays in keyboard mode until the next press.
 */
const lastInput = new WeakMap<Document, { target: EventTarget | null } | null>()

export function trackLastInput(doc: Document): void {
  if (lastInput.has(doc)) return
  lastInput.set(doc, null)
  doc.addEventListener('pointerdown', (ev) => lastInput.set(doc, { target: ev.target }), true)
  doc.addEventListener('keydown', () => lastInput.set(doc, null), true)
}

/** Whether the last input was a press inside [header]. */
export function pressedIn(doc: Document, header: HTMLElement): boolean {
  const last = lastInput.get(doc)
  return last != null && last.target instanceof Node && header.contains(last.target)
}

/**
 * One document listener for every diagram. A re-render replaces the diagrams, so
 * handlers for roots that left the page are dropped on the next press.
 */
const outside = new Map<HTMLElement, (target: Node) => void>()
const listening = new WeakSet<Document>()

export function onOutsidePointer(doc: Document, root: HTMLElement, handler: (target: Node) => void): void {
  outside.set(root, handler)
  if (listening.has(doc)) return
  listening.add(doc)
  doc.addEventListener('pointerdown', (ev) => {
    for (const [el, run] of outside) {
      if (!el.isConnected) outside.delete(el)
      else run(ev.target as Node)
    }
  })
}
