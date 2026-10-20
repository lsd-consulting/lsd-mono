// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Scenario } from '../types'
import {
  closeFocus,
  keyTarget,
  mainClick,
  mainKey,
  openingScenario,
  pageKeyIntent,
  type KeyTarget,
  type PageKeyState,
} from './intents'

const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})
const onPage: KeyTarget = { typing: false, ownKeys: false, arrows: true, onControl: false }
const idle: PageKeyState = { inspectorOpen: false, helpOpen: false, hasScenario: true, singleKeys: true }
const el = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!

describe('keyTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="search"><textarea id="note"></textarea><div id="edit" contenteditable="true"></div>
      <ul id="scenario-nav"><li><button id="item" data-nav="a">A</button></li></ul>
      <h2 id="scenario-title" tabindex="-1">A</h2>
      <a id="link" href="#x">x</a><div id="slider" role="slider" tabindex="0"></div><p id="plain">text</p>
      <div class="seq-scroll" tabindex="0"><button class="msg-open" id="arrow"></button></div>
      <button data-show-components="a" id="components"></button><button data-show-metrics="a" id="metrics"></button>
      <aside id="inspector"><button id="close">Close</button></aside>
      <div id="theme-menu" role="menu"><button role="menuitemradio" id="dark-item">Dark</button></div>`
  })

  it('knows a text field, however it takes text', () => {
    for (const id of ['#search', '#note']) expect(keyTarget(el(id)).typing, id).toBe(true)
    // happy-dom does not compute isContentEditable from the attribute.
    const edit = el('#edit')
    Object.defineProperty(edit, 'isContentEditable', { value: true })
    expect(keyTarget(edit).typing).toBe(true)
    expect(keyTarget(el('#item')).typing).toBe(false)
  })

  it('leaves the arrows, the panel buttons, the panel, the diagram and the theme menu their own keys', () => {
    for (const id of ['#arrow', '#components', '#metrics', '#close', '.seq-scroll', '#dark-item'])
      expect(keyTarget(el(id)).ownKeys, id).toBe(true)
    for (const id of ['#item', '#plain', '#link']) expect(keyTarget(el(id)).ownKeys, id).toBe(false)
  })

  it('moves the selection with the arrows only on the page, the list or the heading', () => {
    expect(keyTarget(document.body).arrows).toBe(true)
    expect(keyTarget(el('#item')).arrows).toBe(true)
    expect(keyTarget(el('#scenario-title')).arrows).toBe(true)
    expect(keyTarget(el('#plain')).arrows).toBe(false)
  })

  it('knows a control that Enter presses', () => {
    for (const id of ['#item', '#link', '#slider']) expect(keyTarget(el(id)).onControl, id).toBe(true)
    expect(keyTarget(el('#plain')).onControl).toBe(false)
  })
})

describe('pageKeyIntent', () => {
  it('lets the open side panel handle Escape first, then the help, then a text field', () => {
    expect(pageKeyIntent(key('Escape'), onPage, { ...idle, inspectorOpen: true, helpOpen: true })).toBeNull()
    expect(pageKeyIntent(key('Escape'), { ...onPage, typing: true }, { ...idle, helpOpen: true })).toBe('close-help')
    expect(pageKeyIntent(key('Escape'), { ...onPage, typing: true }, idle)).toBe('blur')
    expect(pageKeyIntent(key('Escape'), onPage, idle)).toBeNull()
  })

  it('runs the page actions from the key table', () => {
    expect(pageKeyIntent(key('/'), onPage, idle)).toBe('search')
    expect(pageKeyIntent(key('j'), onPage, idle)).toBe('next')
    expect(pageKeyIntent(key('k'), onPage, idle)).toBe('prev')
    expect(pageKeyIntent(key('ArrowDown'), onPage, idle)).toBe('next')
    expect(pageKeyIntent(key('?'), onPage, idle)).toBe('help')
    expect(pageKeyIntent(key('k', { metaKey: true }), { ...onPage, onControl: true }, idle)).toBe('search')
  })

  it('keeps off text fields and controls with keys of their own', () => {
    expect(pageKeyIntent(key('j'), { ...onPage, typing: true }, idle)).toBeNull()
    expect(pageKeyIntent(key('k', { metaKey: true }), { ...onPage, typing: true }, idle)).toBeNull()
    expect(pageKeyIntent(key('j'), { ...onPage, ownKeys: true }, idle)).toBeNull()
  })

  it('leaves the arrows to controls elsewhere, and single keys off when they are turned off', () => {
    expect(pageKeyIntent(key('ArrowDown'), { ...onPage, arrows: false }, idle)).toBeNull()
    expect(pageKeyIntent(key('j'), onPage, { ...idle, singleKeys: false })).toBeNull()
  })

  it('takes Enter into the shown diagram, except on a control', () => {
    expect(pageKeyIntent(key('Enter'), onPage, idle)).toBe('diagram')
    expect(pageKeyIntent(key('Enter'), { ...onPage, onControl: true }, idle)).toBeNull()
    expect(pageKeyIntent(key('Enter'), onPage, { ...idle, hasScenario: false })).toBeNull()
  })
})

describe('mainClick', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <article class="scenario-card" id="card-a">
        <div class="timing-strip">
          <button class="timing-chip" data-show-metrics="a" id="chip0"><span class="k">Wall</span></button>
          <button class="timing-chip" data-show-metrics="a" data-metrics-section="pair-accuracy" id="chip1"></button>
        </div>
        <div class="seq-diagram">
          <nav class="section-jump"><button data-jump-y="120" id="jump"><span id="jump-text">Part 2</span></button></nav>
          <div class="seq-toolbar">
            <button class="panel-btn" data-show-metrics="a" aria-expanded="false" id="metrics">Metrics</button>
            <button class="panel-btn" data-show-components="a" aria-expanded="true" id="components">Components</button>
          </div>
          <div class="seq-scroll"><button class="msg-open" id="arrow"></button>
            <svg><g class="message has-data" data-message-id="m1"><text id="label">call</text></g>
              <g class="message" data-message-id="m2"><text id="plain-label">call</text></g></svg>
          </div>
        </div>
        <button data-show-error="a" id="error">Error</button>
      </article>
      <div class="seq-diagram"><button data-jump-y="5" id="orphan-jump"></button></div>`
  })

  it('scrolls the diagram for a section jump, from anywhere on its button', () => {
    expect(mainClick(el('#jump-text'))).toEqual({ kind: 'jump', scroll: el('.seq-scroll'), y: 120 })
    expect(mainClick(el('#orphan-jump'))).toBeNull()
  })

  it('closes the open view from its expanded button, and opens the others', () => {
    expect(mainClick(el('#components'))).toEqual({ kind: 'close-panel', button: el('#components') })
    expect(mainClick(el('#metrics'))).toEqual({ kind: 'metrics', scenarioId: 'a', section: undefined, chip: null })
    expect(mainClick(el('#error'))).toEqual({ kind: 'error', scenarioId: 'a' })
    el('#components').setAttribute('aria-expanded', 'false')
    expect(mainClick(el('#components'))).toEqual({ kind: 'components', scenarioId: 'a' })
  })

  it('remembers which timing chip opened Metrics, and the section it opens at', () => {
    expect(mainClick(el('#chip0'))).toMatchObject({ kind: 'metrics', chip: 0, section: undefined })
    expect(mainClick(el('#chip0 .k'))).toMatchObject({ kind: 'metrics', chip: 0 })
    expect(mainClick(el('#chip1'))).toMatchObject({ kind: 'metrics', chip: 1, section: 'pair-accuracy' })
  })

  it('opens an arrow drawn as a link, and nothing for one without a payload or for no target', () => {
    expect(mainClick(el('#label'))).toEqual({ kind: 'message', hit: el('.message.has-data'), messageId: 'm1' })
    expect(mainClick(el('#plain-label'))).toBeNull()
    expect(mainClick(el('#arrow'))).toBeNull()
    expect(mainClick(null)).toBeNull()
  })
})

describe('mainKey', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="seq-diagram">
        <input data-diagram-find id="find">
        <div class="seq-scroll" tabindex="0"><button class="msg-open" data-message-id="m1" id="arrow"></button></div>
        <svg><g class="message has-data" data-message-id="m1" tabindex="0" id="hit"></g></svg>
        <p id="plain"></p>
      </div>`
  })

  it('steps the Find matches with Enter, Shift+Enter, F3 and Ctrl or Cmd+G in the Find box', () => {
    const find = el<HTMLInputElement>('#find')
    expect(mainKey(key('Enter'), find)).toEqual({ kind: 'find-step', input: find, step: 1 })
    expect(mainKey(key('Enter', { shiftKey: true }), find)).toEqual({ kind: 'find-step', input: find, step: -1 })
    expect(mainKey(key('g', { ctrlKey: true }), find)).toMatchObject({ step: 1 })
    expect(mainKey(key('a'), find)).toBeNull()
  })

  it('gives keys on the diagram and its arrows to the diagram', () => {
    const scroll = el('.seq-scroll')
    expect(mainKey(key('ArrowDown'), scroll)).toEqual({ kind: 'diagram', scroll, openBtn: null })
    expect(mainKey(key('Enter'), el('#arrow'))).toEqual({ kind: 'diagram', scroll, openBtn: el('#arrow') })
  })

  it('opens an arrow drawn as a link with Enter or Space only', () => {
    const hit = el<SVGGElement>('#hit')
    expect(mainKey(key('Enter'), hit)).toEqual({ kind: 'open-message', hit, messageId: 'm1' })
    expect(mainKey(key(' '), hit)).toMatchObject({ kind: 'open-message' })
    expect(mainKey(key('a'), hit)).toBeNull()
    expect(mainKey(key('Enter'), el('#plain'))).toBeNull()
    expect(mainKey(key('Enter'), null)).toBeNull()
  })
})

describe('closeFocus', () => {
  it('leaves focus to the next scenario when one is about to show', () => {
    expect(closeFocus({ scenarioId: 'a', kind: 'metrics' }, true, 1)).toEqual({ kind: 'none' })
  })

  it('goes back to the toolbar button, or the timing chip that opened Metrics', () => {
    expect(closeFocus({ scenarioId: 'a', kind: 'components' }, false, 1)).toEqual({
      kind: 'button',
      scenarioId: 'a',
      selector: '.seq-toolbar [data-show-components]',
      chip: null,
    })
    expect(closeFocus({ scenarioId: 'a', kind: 'metrics' }, false, null)).toEqual({
      kind: 'button',
      scenarioId: 'a',
      selector: '.seq-toolbar [data-show-metrics]',
      chip: null,
    })
    expect(closeFocus({ scenarioId: 'a', kind: 'metrics' }, false, 2)).toMatchObject({ chip: 2 })
  })

  it('goes back to the message that was open, or nowhere', () => {
    expect(closeFocus({ scenarioId: 'a', messageId: 'm1', kind: 'message' }, false, null)).toEqual({
      kind: 'message',
      scenarioId: 'a',
      messageId: 'm1',
    })
    expect(closeFocus({ scenarioId: 'a' }, false, null)).toEqual({ kind: 'none' })
    expect(closeFocus(null, false, null)).toEqual({ kind: 'none' })
  })
})

describe('openingScenario', () => {
  const scenario = (id: string, status: Scenario['status']) => ({ id, status }) as Scenario
  const report = [scenario('a', 'success'), scenario('b', 'error'), scenario('c', 'error')]

  it('opens the linked scenario when the report has it', () => {
    expect(openingScenario(report, { scenarioId: 'c' })).toEqual({ wanted: 'c', selectedId: 'c' })
  })

  it('opens a failed report at its first failure, else at its first scenario', () => {
    expect(openingScenario(report, { scenarioId: 'gone' })).toEqual({ wanted: null, selectedId: 'b' })
    expect(openingScenario(report, undefined)).toEqual({ wanted: null, selectedId: 'b' })
    expect(openingScenario([scenario('a', 'success'), scenario('d', 'warn')], { scenarioId: '' })).toEqual({
      wanted: null,
      selectedId: 'a',
    })
    expect(openingScenario([], undefined)).toEqual({ wanted: null, selectedId: null })
  })
})
