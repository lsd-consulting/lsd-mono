// The keyboard help (#112): a non-modal dialog named "Keyboard shortcuts", opened by the top bar's
// ? button or the ? key. Open moves focus to its close button; ×, Escape and ? close it and give
// focus back to whatever opened it; a press outside closes it and leaves focus where it lands. On
// phones it is a bottom sheet with the close button pinned at its top (narrow.css), so it can be
// closed after the ? button has scrolled away.

export interface HelpDialog {
  open: () => void
  /** Close; with [returnFocus], focus inside the dialog (or lost) goes back to the opener. */
  close: (returnFocus: boolean) => void
  toggle: () => void
  isOpen: () => boolean
}

/** The dialog's markup: [bodyHtml] is the help text and the single-keys setting. */
export function helpDialogHtml(bodyHtml: string): string {
  return `
    <div class="help-toast" id="help" data-open="false" role="dialog" aria-labelledby="help-title">
      <div class="help-head">
        <h2 class="help-title" id="help-title">Keyboard shortcuts</h2>
        <button type="button" class="icon-btn help-close" id="help-close" aria-label="Close keyboard help" title="Close (Esc)">
          <svg class="help-close-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
      <div class="help-body">${bodyHtml}</div>
    </div>`
}

export function bindHelpDialog(doc: Document): HelpDialog {
  const panel = doc.querySelector<HTMLElement>('#help')!
  const button = doc.querySelector<HTMLButtonElement>('#btn-help')!
  const closeBtn = panel.querySelector<HTMLButtonElement>('#help-close')!
  let opener: HTMLElement | null = null
  button.setAttribute('aria-controls', 'help')
  button.setAttribute('aria-expanded', 'false')

  const isOpen = () => panel.dataset.open === 'true'
  const set = (open: boolean) => {
    panel.dataset.open = String(open)
    button.setAttribute('aria-expanded', String(open))
  }

  function open(): void {
    if (isOpen()) return
    const active = doc.activeElement
    opener = active instanceof HTMLElement && active !== doc.body ? active : button
    set(true)
    closeBtn.focus({ preventScroll: true })
  }

  function close(returnFocus: boolean): void {
    if (!isOpen()) return
    const active = doc.activeElement
    const focusInside = panel.contains(active) || !active || active === doc.body
    set(false)
    const back = opener?.isConnected ? opener : button
    opener = null
    if (returnFocus && focusInside) back.focus({ preventScroll: true })
  }

  const toggle = () => (isOpen() ? close(true) : open())

  button.addEventListener('click', toggle)
  closeBtn.addEventListener('click', () => close(true))
  // A press outside closes it; the ? button toggles it itself.
  doc.addEventListener('pointerdown', (ev) => {
    const target = ev.target as Node | null
    if (!isOpen() || !target || panel.contains(target) || button.contains(target)) return
    close(false)
  })

  return { open, close, toggle, isOpen }
}
