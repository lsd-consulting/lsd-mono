// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applySidebarCollapsed,
  getSidebarCollapsed,
  navItemTooltip,
  readStoredSidebar,
  sidebarToggleGlyph,
  sidebarToggleLabel,
  storeSidebarCollapsed,
} from './sidebar'

describe('sidebar collapse', () => {
  beforeEach(() => localStorage.clear())

  it('starts expanded and only collapses for the stored value', () => {
    expect(readStoredSidebar(null)).toBe(false)
    expect(readStoredSidebar('nope')).toBe(false)
    expect(readStoredSidebar('expanded')).toBe(false)
    expect(readStoredSidebar('collapsed')).toBe(true)
  })

  it('remembers the choice in localStorage, like the theme', () => {
    expect(getSidebarCollapsed()).toBe(false)
    storeSidebarCollapsed(true)
    expect(localStorage.getItem('lsd-report-sidebar')).toBe('collapsed')
    expect(getSidebarCollapsed()).toBe(true)
    storeSidebarCollapsed(false)
    expect(getSidebarCollapsed()).toBe(false)
  })

  it('labels the toggle with what it will do', () => {
    expect(sidebarToggleLabel(false)).toBe('Collapse scenario list')
    expect(sidebarToggleLabel(true)).toBe('Expand scenario list')
    expect(sidebarToggleGlyph(false)).not.toBe(sidebarToggleGlyph(true))
  })

  it('marks the shell and the toggle button', () => {
    document.body.innerHTML = `
      <div class="shell"><aside class="sidebar" id="sidebar">
        <button type="button" id="btn-sidebar" aria-controls="sidebar"></button>
      </aside></div>`
    const shell = document.querySelector<HTMLElement>('.shell')!
    const btn = document.querySelector<HTMLButtonElement>('#btn-sidebar')!
    applySidebarCollapsed(shell, btn, true)
    expect(shell.classList.contains('sidebar-collapsed')).toBe(true)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('Expand scenario list')
    expect(btn.title).toBe('Expand scenario list')
    expect(btn.textContent).toBe(sidebarToggleGlyph(true))
    applySidebarCollapsed(shell, btn, false)
    expect(shell.classList.contains('sidebar-collapsed')).toBe(false)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-label')).toBe('Collapse scenario list')
  })

  it('gives rail items a tooltip with the scenario title and status', () => {
    expect(navItemTooltip('Happy path', 'Success', 22)).toBe('Happy path. Success · 22 messages')
  })
})
