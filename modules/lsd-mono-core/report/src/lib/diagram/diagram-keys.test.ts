// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { diagramKeyContext } from './diagram-keys'
import { diagramState, diagramView } from './state'

const el = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const page = { singleKeys: true, panelOpen: false }

beforeEach(() => {
  diagramState.mounted.clear()
  document.body.innerHTML = `
    <div class="seq-diagram">
      <input data-diagram-find id="find">
      <input id="other-field">
      <div role="menu"><button id="menu-item"></button></div>
      <button id="tool"></button>
      <div class="seq-scroll" data-scenario-id="s1" tabindex="0">
        <button class="msg-open" data-message-id="m1" id="arrow"></button>
        <svg><g class="message has-data" data-message-id="m2" tabindex="0" id="hit"></g></svg>
      </div>
    </div>
    <p id="outside"></p>`
})

describe('diagramKeyContext', () => {
  it('names where in the card the key was pressed', () => {
    expect(diagramKeyContext(el('#find'), page)?.on).toBe('find')
    expect(diagramKeyContext(el('#arrow'), page)).toMatchObject({ on: 'arrow', messageId: 'm1' })
    expect(diagramKeyContext(el('.seq-scroll'), page)).toMatchObject({ on: 'scrollport', messageId: null })
    expect(diagramKeyContext(el('#hit'), page)).toMatchObject({ on: 'link', messageId: 'm2' })
    expect(diagramKeyContext(el('#tool'), page)?.on).toBe('card')
    expect(diagramKeyContext(el('#tool'), page)?.scrollport).toBe(el('.seq-scroll'))
  })

  it('leaves other text fields, menus and the rest of the page alone', () => {
    expect(diagramKeyContext(el('#other-field'), page)).toBeNull()
    expect(diagramKeyContext(el('#menu-item'), page)).toBeNull()
    expect(diagramKeyContext(el('#outside'), page)).toBeNull()
    expect(diagramKeyContext(null, page)).toBeNull()
    expect(diagramKeyContext(document, page)).toBeNull()
  })

  it('zooms only a mounted diagram, and reads its Overview and the page state', () => {
    expect(diagramKeyContext(el('#tool'), page)).toMatchObject({ zoomable: false, overview: false })
    diagramState.mounted.set('s1', {} as never)
    expect(diagramKeyContext(el('#tool'), page)).toMatchObject({ zoomable: true, overview: false })
    diagramView('s1').mode = { kind: 'overview', fittedWidth: 0, saved: {} } as never
    expect(diagramKeyContext(el('#tool'), { singleKeys: false, panelOpen: true })).toMatchObject({
      overview: true,
      singleKeys: false,
      panelOpen: true,
    })
  })
})
