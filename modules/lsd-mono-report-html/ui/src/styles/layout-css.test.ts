import { readAppCss, readDiagramCss } from './read-css.test-util'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readAppCss()
const diagramCss = readDiagramCss()

/** Body of the first rule whose selector is exactly `selector`, in app.css or [from]. */
function rule(selector: string, from = css): string {
  const match = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(from)
  expect(match, `${selector} not found`).not.toBeNull()
  return match![2]
}

describe('main content width', () => {
  it('has no width cap, so it fills the space the sidebar and side panel leave', () => {
    expect(rule('.main')).not.toMatch(/max-width/)
  })
})

describe('top bar on a narrow screen', () => {
  it('gives the bar an auto row, so it holds its wrapped search and status filters', () => {
    // A fixed row clamped the sticky bar, and the filters floated over the page on phones.
    expect(rule('#app')).toMatch(/grid-template-rows:\s*auto\s+1fr/)
  })

  it('sizes the one-row bar from its token, not from the tracked --topbar-h', () => {
    // --topbar-h follows the measured bar. Sizing the bar from it would keep a phone's
    // three-row height after the window widens.
    expect(rule('.topbar')).toMatch(/height:\s*var\(--topbar-row-h\)/)
  })

  it('stops in-page jumps below the sticky bar', () => {
    expect(rule('html')).toMatch(/scroll-padding-top:\s*var\(--topbar-h\)/)
  })
})

describe('the header buttons (#92)', () => {
  it('open just under the header, never on the name they act on', () => {
    expect(rule('.participant-head-actions', diagramCss)).toMatch(/top:\s*calc\(100% \+ 2px\)/)
  })

  it('bridge the gap under the header, so the pointer keeps the bar open on its way down', () => {
    expect(rule('.participant-head-actions::before', diagramCss)).toMatch(/inset:\s*-4px 0 100%/)
  })

  it('sit over the More lanes cue: the header stacks above it', () => {
    const z = (selector: string) => Number(/z-index:\s*(\d+)/.exec(rule(selector, diagramCss))?.[1])
    expect(z('.seq-sticky-header')).toBeGreaterThan(z('.seq-more'))
  })
})

describe('focus in forced colours (#116)', () => {
  it('gives every keyboard focus a system-colour outline inside the control, over its own outline: none', () => {
    const block = /@media \(forced-colors: active\) \{\s*:focus-visible:not\(svg, svg \*\) \{([^}]*)\}/.exec(css)
    expect(block, 'forced-colours :focus-visible rule').not.toBeNull()
    expect(block![1]).toMatch(/outline:\s*2px solid Highlight !important/)
    expect(block![1]).toMatch(/outline-offset:\s*-2px !important/)
  })

  it('only there: outside forced colours the rings stay box-shadows', () => {
    const outside = css.replace(/@media \(forced-colors: active\) \{[\s\S]*?\n\}/g, '')
    expect(outside).not.toMatch(/:focus-visible:not\(svg/)
  })

  it('stops focus in the side panel below its sticky head, and ends the phone chip row on a snap point', () => {
    expect(rule('.inspector')).toMatch(/scroll-padding-top:\s*calc\(var\(--inspector-head-h, 65px\) \+ 8px\)/)
    const timing = readFileSync(new URL('./timing.css', import.meta.url), 'utf8')
    expect(timing).toMatch(/\.timing-strip > li:last-child \{\s*scroll-snap-align: end;/)
  })
})
