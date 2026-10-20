// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { bindHelpDialog, helpDialogHtml, type HelpDialog } from './help-dialog'

let dialog: HelpDialog
const panel = () => document.querySelector<HTMLElement>('#help')!
const button = () => document.querySelector<HTMLButtonElement>('#btn-help')!
const closeBtn = () => document.querySelector<HTMLButtonElement>('#help-close')!

beforeEach(() => {
  document.body.innerHTML = `<button id="btn-help">?</button><a href="#x" id="elsewhere">x</a>${helpDialogHtml('<input type="checkbox" id="single-keys">')}`
  dialog = bindHelpDialog(document)
})

describe('keyboard help dialog (#112)', () => {
  it('is a non-modal dialog named Keyboard shortcuts, with a named close button', () => {
    expect(panel().getAttribute('role')).toBe('dialog')
    expect(panel().hasAttribute('aria-modal')).toBe(false)
    const title = document.getElementById(panel().getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe('Keyboard shortcuts')
    expect(closeBtn().getAttribute('aria-label')).toBe('Close keyboard help')
    expect(button().getAttribute('aria-controls')).toBe('help')
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens from ?, moves focus to the close button, and × gives it back to ?', () => {
    button().focus()
    button().click()
    expect(dialog.isOpen()).toBe(true)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(closeBtn())
    closeBtn().click()
    expect(dialog.isOpen()).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button())
  })

  it('gives focus back to what opened it, or to ? when nothing had focus', () => {
    const link = document.querySelector<HTMLElement>('#elsewhere')!
    link.focus()
    dialog.open()
    dialog.close(true)
    expect(document.activeElement).toBe(link)
    ;(document.activeElement as HTMLElement).blur()
    dialog.open()
    dialog.close(true)
    expect(document.activeElement).toBe(button())
  })

  it('toggles with ?, and leaves focus alone when it is outside the dialog on close', () => {
    button().click()
    button().focus()
    button().click()
    expect(dialog.isOpen()).toBe(false)
    expect(document.activeElement).toBe(button())
    dialog.toggle()
    expect(dialog.isOpen()).toBe(true)
    dialog.close(false)
    dialog.close(false)
    expect(dialog.isOpen()).toBe(false)
  })

  it('closes on a press outside, but not on a press inside or on ?', () => {
    dialog.open()
    closeBtn().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    button().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(dialog.isOpen()).toBe(true)
    document.querySelector('#elsewhere')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(dialog.isOpen()).toBe(false)
  })
})
