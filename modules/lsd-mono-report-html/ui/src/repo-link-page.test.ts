// @vitest-environment happy-dom
// The logo in the top bar and the version in the hero link to the lsd-mono repository: in a new
// tab, without handing the report's address to GitHub, named for screen readers and reachable
// with Tab (plain links, no tabindex tricks). Their styles: styles/repo-link-css.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportBase, untimed } from './lib/report-fixture.test-util'
import type { Report } from './types'
import { REPO_URL } from './ui/repo-link'

function report(generator: string): Report {
  return {
    ...reportBase(),
    title: 'Checkout',
    generatedAt: '2026-01-01T12:00:00Z',
    generator,
    scenarios: [
      {
        ...untimed(),
        id: 'pay',
        title: 'Pay',
        status: 'success',
        description: '',
        facts: [],
        metrics: [],
        participants: [{ id: 'a', name: 'A', type: 'ACTOR' }],
        events: [{ kind: 'message', id: 'm1', from: 'a', to: 'a', label: 'think', type: 'SYNCHRONOUS' }],
      },
    ],
  }
}

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  window.location.hash = ''
})

afterEach(() => {
  delete window.__LSD_REPORT__
})

function expectRepoLink(link: HTMLAnchorElement | null, name: string) {
  expect(link).not.toBeNull()
  expect(link!.getAttribute('href')).toBe(REPO_URL)
  expect(link!.getAttribute('target')).toBe('_blank')
  expect(link!.getAttribute('rel')?.split(/\s+/).sort()).toEqual(['noopener', 'noreferrer'])
  expect(link!.getAttribute('title')).toBe('lsd-mono on GitHub')
  expect(link!.getAttribute('aria-label')).toBe(name)
  expect(link!.hasAttribute('tabindex')).toBe(false)
}

describe('links to the lsd-mono repository', () => {
  it('makes the logo and the version links to GitHub, opened in a new tab', async () => {
    window.__LSD_REPORT__ = report('lsd-mono-jvm 0.12.0')
    await import('./main')

    const logo = document.querySelector<HTMLAnchorElement>('.topbar a.brand-mark')
    expectRepoLink(logo, 'Living Sequence Diagrams: lsd-mono on GitHub')
    expect(logo!.textContent).toBe('LSD')

    // The chip is the page's own version (dev in tests), not what wrote the data.
    const version = document.querySelector<HTMLAnchorElement>('.report-hero .meta a.version-link')
    expectRepoLink(version, 'lsd-mono dev: lsd-mono on GitHub')
    expect(version!.querySelector('code')?.textContent).toBe('lsd-mono dev')
    expect(document.querySelector('.report-hero .meta .generator')?.textContent).toBe('Written by lsd-mono-jvm 0.12.0')
  })

  it('leaves out what wrote the data when the report does not say', async () => {
    window.__LSD_REPORT__ = report('')
    await import('./main')
    expect(document.querySelector('.report-hero .meta .generator')).toBeNull()
    expect(document.querySelector('a.version-link')?.textContent).toBe('lsd-mono dev')
  })

  it('keeps a hostile generator as text', async () => {
    const hostile = 'x"><img src=x onerror=alert(1)>'
    window.__LSD_REPORT__ = report(hostile)
    await import('./main')

    const written = document.querySelector('.report-hero .meta .generator')!
    expect(written.querySelector('img')).toBeNull()
    expect(written.textContent).toBe(`Written by ${hostile}`)
  })
})
