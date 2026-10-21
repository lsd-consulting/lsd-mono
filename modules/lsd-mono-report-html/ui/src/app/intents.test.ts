// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Scenario } from '../types'
import { fieldEscapeTargets, isTextField, keyTarget, mainClick, openingScenario } from './intents'

const el = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!

describe('keyTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="search"><textarea id="note"></textarea><div id="edit" contenteditable="true"></div>
      <ul id="scenario-nav"><li><button id="item" data-nav="a">A</button></li></ul>
      <h2 id="scenario-title" tabindex="-1">A</h2>
      <a id="link" href="#x">x</a><div id="slider" role="slider" tabindex="0"></div><p id="plain">text</p>
      <div class="seq-scroll" tabindex="0"><button class="msg-open" id="arrow"></button></div>
      <div class="comp-scroll" tabindex="0"><svg><g class="edge-group" tabindex="0" id="comp-link"></g></svg></div>
      <button data-show-metrics="a" id="metrics"></button>
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

  it('leaves the arrows, the panel buttons, the panel, both views and the theme menu their own keys', () => {
    for (const id of ['#arrow', '#metrics', '#close', '.seq-scroll', '.comp-scroll', '#comp-link', '#dark-item'])
      expect(keyTarget(el(id)).ownKeys, id).toBe(true)
    for (const id of ['#item', '#plain', '#link']) expect(keyTarget(el(id)).ownKeys, id).toBe(false)
  })

  it('knows an open menu or popover, where ? keeps off', () => {
    expect(keyTarget(el('#dark-item')).inMenu).toBe(true)
    expect(keyTarget(el('#theme-menu')).inMenu).toBe(true)
    for (const id of ['#arrow', '#close', '#item']) expect(keyTarget(el(id)).inMenu, id).toBe(false)
  })

  it('moves the selection with the arrows only on the page, the list or the heading', () => {
    expect(keyTarget(document.body).arrows).toBe(true)
    expect(keyTarget(el('#item')).arrows).toBe(true)
    expect(keyTarget(el('#scenario-title')).arrows).toBe(true)
    expect(keyTarget(el('#plain')).arrows).toBe(false)
  })

  it('knows a field Escape can clear (#114): text inputs and textareas, not a checkbox', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<input type="checkbox" id="check"><input type="range" id="range"><input type="SEARCH" id="upper">',
    )
    for (const id of ['#search', '#note', '#upper']) expect(isTextField(el(id)), id).toBe(true)
    for (const id of ['#check', '#range', '#edit', '#item']) expect(isTextField(el(id)), id).toBe(false)
    expect(keyTarget(el('#check'))).toMatchObject({ typing: true, textField: false, fieldHasText: false })
    expect(keyTarget(el('#search'))).toMatchObject({ textField: true, fieldHasText: false })
    el<HTMLInputElement>('#search').value = 'order'
    expect(keyTarget(el('#search')).fieldHasText).toBe(true)
    expect(keyTarget(el('#item'))).toMatchObject({ textField: false, fieldHasText: false })
  })

  it('knows a control that Enter presses', () => {
    for (const id of ['#item', '#link', '#slider']) expect(keyTarget(el(id)).onControl, id).toBe(true)
    expect(keyTarget(el('#plain')).onControl).toBe(false)
  })
})

describe('fieldEscapeTargets', () => {
  const ids = (field: Element) => fieldEscapeTargets(field).map((t) => t.id)

  it("gives Find's focus to its own diagram's scrollport", () => {
    document.body.innerHTML = `
      <div class="seq-diagram" id="one"><input type="search" data-diagram-find id="find1"><div class="seq-scroll" id="scroll1"></div></div>
      <div class="seq-diagram" id="two"><input type="search" data-diagram-find id="find2"><div class="seq-scroll" id="scroll2"></div></div>`
    expect(ids(el('#find1'))).toEqual(['scroll1'])
    expect(ids(el('#find2'))).toEqual(['scroll2'])
  })

  it("gives search's focus to the scenario heading, else the selected list item, else the list's first", () => {
    document.body.innerHTML = `
      <input type="search" id="search">
      <ul id="scenario-nav"><li><button id="first" data-nav="a">A</button></li><li><button id="current" data-nav="b" aria-current="true">B</button></li></ul>
      <main id="main"><div class="scenario-head"><h2 id="scenario-title" tabindex="-1">B</h2></div></main>`
    expect(ids(el('#search'))).toEqual(['scenario-title', 'current', 'first'])
    el('.scenario-head').remove()
    expect(ids(el('#search'))).toEqual(['current', 'first'])
    el('#current').removeAttribute('aria-current')
    expect(ids(el('#search'))).toEqual(['first'])
  })

  it('has nowhere to go with nothing listed, so the field keeps focus (never the body)', () => {
    document.body.innerHTML = `<input type="search" id="search"><ul id="scenario-nav"></ul><main id="main"></main>`
    expect(ids(el('#search'))).toEqual([])
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
            <button class="panel-btn" data-show-metrics="a" aria-expanded="true" id="metrics">Metrics</button>
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
    expect(mainClick(el('#metrics'))).toEqual({ kind: 'close-panel', button: el('#metrics') })
    expect(mainClick(el('#error'))).toEqual({ kind: 'error', scenarioId: 'a' })
    el('#metrics').setAttribute('aria-expanded', 'false')
    expect(mainClick(el('#metrics'))).toEqual({ kind: 'metrics', scenarioId: 'a', section: undefined, chip: null })
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
