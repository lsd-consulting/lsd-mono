// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { INTRO_DISMISSED_KEY, bindExampleIntro, exampleIntroHtml, showExampleIntro } from './example-intro'

beforeEach(() => {
  window.localStorage.clear()
  window.__LSD_EXAMPLE__ = true
})

describe('example intro binding (#161)', () => {
  it('shows on the example until dismissed', () => {
    expect(showExampleIntro(window)).toBe(true)
    window.localStorage.setItem(INTRO_DISMISSED_KEY, '1')
    expect(showExampleIntro(window)).toBe(false)
  })

  it('still shows when local storage is blocked', () => {
    const win = {
      location: window.location,
      __LSD_EXAMPLE__: true,
      get localStorage(): Storage {
        throw new Error('blocked')
      },
    } as unknown as Window
    expect(showExampleIntro(win)).toBe(true)
  })

  it('× removes the intro, remembers it and focuses the scenario heading', () => {
    document.body.innerHTML = `${exampleIntroHtml()}<main id="main"><div class="scenario-head"><h2 tabindex="-1">S</h2></div></main><input id="search">`
    bindExampleIntro(document, window)
    document.querySelector<HTMLButtonElement>('#example-intro-close')!.click()
    expect(document.querySelector('#example-intro')).toBeNull()
    expect(showExampleIntro(window)).toBe(false)
    expect(document.activeElement?.tagName).toBe('H2')
  })

  it('× falls back to search when no scenario is open', () => {
    document.body.innerHTML = `${exampleIntroHtml()}<input id="search">`
    bindExampleIntro(document, window)
    document.querySelector<HTMLButtonElement>('#example-intro-close')!.click()
    expect(document.activeElement?.id).toBe('search')
  })
})
