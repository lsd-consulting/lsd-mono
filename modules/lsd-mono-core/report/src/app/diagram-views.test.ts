// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Sequence | Components switch (#105) on a hand-built card: what each view shows, what it
// keeps of the other, the side panel it closes, the tabs' keys, and a link's way back to Sequence.
const panel = vi.hoisted(() => ({ openMessage: vi.fn(), syncWithPanel: vi.fn() }))
const hash = vi.hoisted(() => ({ writeScenarioHash: vi.fn() }))
const usage = vi.hoisted(() => ({ ping: vi.fn() }))
const pageScroll = vi.hoisted(() => ({ sizeStage: vi.fn(), scrollDiagramToOffset: vi.fn() }))
const diagram = vi.hoisted(() => ({
  diagramView: vi.fn(() => ({ zoom: 0.8 })),
  findMessage: vi.fn(),
  focusDiagramMessage: vi.fn(),
  syncDiagramWindow: vi.fn(),
}))
const drawn = vi.hoisted((): { value: unknown } => ({ value: undefined }))
const mounted = vi.hoisted(() => new Set<string>())
interface Inspector {
  isOpen: ReturnType<typeof vi.fn<() => boolean>>
  close: ReturnType<typeof vi.fn>
  openLink: ReturnType<typeof vi.fn>
}
interface Session extends Record<string, unknown> {
  inspector: Inspector
}
const ctx = vi.hoisted((): { session: Session } => ({ session: {} as Session }))

vi.mock('./panel', () => panel)
vi.mock('./url-hash', () => hash)
vi.mock('../lib/usage-ping', () => ({ usage }))
vi.mock('../lib/diagram/page-scroll', () => pageScroll)
vi.mock('../lib/sequence-diagram', () => diagram)
vi.mock('../lib/diagram/state', () => ({ diagramState: { mounted } }))
vi.mock('../lib/component-view', () => ({ mountedComponents: () => drawn.value }))
vi.mock('./context', () => ({
  get session() {
    return ctx.session
  },
}))

const views = await import('./diagram-views')

const scenario = {
  id: 'checkout',
  title: 'Checkout',
  events: [
    { kind: 'message', id: 'm1' },
    { kind: 'note', id: 'n1' },
    { kind: 'message', id: 'm2' },
  ],
}
const graph = { nodes: [{}, {}, {}], edges: [{}] }

function card(withComponents = true): void {
  const tab = (name: string, selected: boolean) =>
    `<button type="button" role="tab" id="diagram-tab-${name}" data-diagram-view="${name}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${name}</button>`
  document.body.innerHTML = `<main id="main"><article class="scenario-card" id="card-checkout">
    <section class="diagram-panel" data-view="sequence">
      <div class="diagram-heading"><h3 id="diagram-title">Sequence diagram</h3>
        <div class="diagram-tabs" role="tablist">${tab('sequence', true)}${tab('components', false)}</div>
        <span class="diagram-hint">hint</span><span class="diagram-view-status" role="status"></span></div>
      <div class="diagram-area" role="tabpanel" aria-labelledby="diagram-tab-sequence">
        <div class="diagram-pane" data-pane="sequence"><div class="seq-scroll"></div></div>
        ${withComponents ? '<div class="diagram-pane" data-pane="components" hidden><div class="comp-scroll"><g class="edge-group" tabindex="0"></g></div></div>' : ''}
      </div>
    </section></article></main>`
}

const area = () => document.querySelector<HTMLElement>('.diagram-panel')!
const pane = (name: string) => document.querySelector<HTMLElement>(`[data-pane="${name}"]`)!
const tab = (name: string) => document.querySelector<HTMLElement>(`#diagram-tab-${name}`)!

beforeEach(() => {
  vi.clearAllMocks()
  mounted.clear()
  drawn.value = { graph }
  const inspector = { isOpen: vi.fn(() => false), close: vi.fn(), openLink: vi.fn() }
  ctx.session = {
    report: { scenarios: [scenario] },
    renderedId: 'checkout',
    diagramView: 'sequence',
    inspector,
    invoker: null,
    switchingScenario: false,
  }
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => run())
  card()
})

describe('viewAnnouncement', () => {
  it('counts what each view draws and gives its zoom', () => {
    expect(views.viewAnnouncement(scenario as never, 'sequence')).toBe('Sequence diagram, 2 messages, zoom 80%')
    expect(views.viewAnnouncement(scenario as never, 'components')).toBe(
      'Component diagram, 3 components, 1 link, zoom 100%',
    )
    drawn.value = undefined
    expect(views.viewAnnouncement(scenario as never, 'components')).toBe(
      'Component diagram, 0 components, 0 links, zoom 100%',
    )
  })
})

describe('showDiagramView', () => {
  it('shows Components: pane, heading, tabs, the URL, the ping and the status line', () => {
    views.showDiagramView('components')
    expect(ctx.session.diagramView).toBe('components')
    expect(area().dataset.view).toBe('components')
    expect(pane('sequence').hidden).toBe(true)
    expect(pane('components').hidden).toBe(false)
    expect(document.querySelector('#diagram-title')!.textContent).toBe('Component diagram')
    expect(document.querySelector('.diagram-hint')!.textContent).toBe(
      'Zoom and overview (a click there zooms in) · links list their messages',
    )
    expect(document.querySelector('.diagram-area')!.getAttribute('aria-labelledby')).toBe('diagram-tab-components')
    expect(tab('components').getAttribute('aria-selected')).toBe('true')
    expect(tab('components').tabIndex).toBe(0)
    expect(tab('sequence').tabIndex).toBe(-1)
    expect(usage.ping).toHaveBeenCalledWith('components-open')
    expect(hash.writeScenarioHash).toHaveBeenCalled()
    expect(document.querySelector('.diagram-view-status')!.textContent).toContain('Component diagram, 3 components')
  })

  it('gives the sequence scrollport its place back, after sizing the page to it', () => {
    const scroll = document.querySelector<HTMLElement>('.seq-scroll')!
    scroll.scrollTop = 120
    scroll.scrollLeft = 40
    views.showDiagramView('components')
    scroll.scrollTop = 0
    scroll.scrollLeft = 0
    views.showDiagramView('sequence', false)
    expect(pageScroll.sizeStage).toHaveBeenCalledWith(scroll)
    expect(pageScroll.scrollDiagramToOffset).toHaveBeenCalledWith(scroll, 120)
    expect(diagram.syncDiagramWindow).toHaveBeenCalledWith(scroll)
    expect(scroll.scrollLeft).toBe(40)
    expect(pane('sequence').hidden).toBe(false)
    expect(usage.ping).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.diagram-view-status')!.textContent).toBe(
      'Component diagram, 3 components, 1 link, zoom 100%',
    )
  })

  it('gives the Components scrollport its place back after a trip to Sequence (M17)', () => {
    const drawing = document.querySelector<HTMLElement>('.comp-scroll')!
    views.showDiagramView('components')
    drawing.scrollTop = 80
    drawing.scrollLeft = 30
    views.showDiagramView('sequence', false)
    drawing.scrollTop = 0
    drawing.scrollLeft = 0
    views.showDiagramView('components', false)
    expect([drawing.scrollTop, drawing.scrollLeft]).toEqual([80, 30])
  })

  it('selecting the shown view only writes the URL and says it again', () => {
    views.showDiagramView('sequence')
    expect(pageScroll.sizeStage).not.toHaveBeenCalled()
    expect(hash.writeScenarioHash).toHaveBeenCalled()
    expect(document.querySelector('.diagram-view-status')!.textContent).toBe('Sequence diagram, 2 messages, zoom 80%')
  })

  it('a scenario with no component diagram stays on Sequence, and no card does nothing', () => {
    card(false)
    views.showDiagramView('components')
    expect(ctx.session.diagramView).toBe('sequence')
    expect(area().dataset.view).toBe('sequence')
    document.body.innerHTML = ''
    views.showDiagramView('components')
    expect(hash.writeScenarioHash).not.toHaveBeenCalled()
  })

  it('closes a message panel on the way to Components and a link panel on the way back, without giving focus back', () => {
    const inspector = ctx.session.inspector
    inspector.isOpen.mockReturnValue(true)
    inspector.close.mockImplementation(() => expect(ctx.session.switchingScenario).toBe(true))
    ctx.session.invoker = { scenarioId: 'checkout', kind: 'message', messageId: 'm1' }
    views.showDiagramView('components')
    expect(inspector.close).toHaveBeenCalledTimes(1)
    expect(ctx.session.switchingScenario).toBe(false)

    ctx.session.invoker = { scenarioId: 'checkout', kind: 'metrics' }
    views.showDiagramView('sequence')
    expect(inspector.close).toHaveBeenCalledTimes(1)
    views.showDiagramView('components')
    ctx.session.invoker = { scenarioId: 'checkout', kind: 'link', edge: 0 }
    views.showDiagramView('sequence')
    expect(inspector.close).toHaveBeenCalledTimes(2)

    // Another scenario's panel is not this view's to close.
    ctx.session.invoker = { scenarioId: 'other', kind: 'message', messageId: 'm1' }
    views.showDiagramView('components')
    expect(inspector.close).toHaveBeenCalledTimes(2)
  })
})

describe('pingShownView', () => {
  it('counts a card drawn showing Components as an open, and one showing Sequence not', () => {
    views.pingShownView(document)
    expect(usage.ping).not.toHaveBeenCalled()
    area().dataset.view = 'components'
    views.pingShownView(document)
    expect(usage.ping).toHaveBeenCalledWith('components-open')
  })
})

describe('bindDiagramTabs', () => {
  it('a click selects, but not on a disabled tab', () => {
    views.bindDiagramTabs(document)
    tab('components').click()
    expect(area().dataset.view).toBe('components')
    tab('sequence').click()
    tab('components').setAttribute('aria-disabled', 'true')
    tab('components').click()
    expect(area().dataset.view).toBe('sequence')
    document.querySelector<HTMLElement>('.diagram-tabs')!.click()
    expect(area().dataset.view).toBe('sequence')
  })

  it('arrows, Home and End move focus and the tab stop without selecting; other keys pass', () => {
    views.bindDiagramTabs(document)
    const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      target.dispatchEvent(ev)
      return ev
    }
    tab('sequence').focus()
    expect(press(tab('sequence'), 'ArrowRight').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(tab('components'))
    expect(tab('components').tabIndex).toBe(0)
    expect(tab('sequence').tabIndex).toBe(-1)
    expect(area().dataset.view).toBe('sequence')
    press(tab('components'), 'ArrowRight')
    expect(document.activeElement).toBe(tab('sequence'))
    press(tab('sequence'), 'ArrowLeft')
    expect(document.activeElement).toBe(tab('components'))
    press(tab('components'), 'Home')
    expect(document.activeElement).toBe(tab('sequence'))
    press(tab('sequence'), 'End')
    expect(document.activeElement).toBe(tab('components'))
    expect(press(tab('components'), 'x').defaultPrevented).toBe(false)
    expect(press(tab('components'), 'ArrowLeft', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(press(document.querySelector('.diagram-tabs')!, 'ArrowLeft').defaultPrevented).toBe(false)
  })

  it('does nothing without tabs', () => {
    document.body.innerHTML = '<main id="main"></main>'
    expect(() => views.bindDiagramTabs(document)).not.toThrow()
  })
})

describe('links and the way back to Sequence', () => {
  it('openLink opens the link in the side panel and notes what opened it', () => {
    views.openLink('checkout', 0)
    expect(ctx.session.invoker).toEqual({ scenarioId: 'checkout', kind: 'link', edge: 0 })
    expect(ctx.session.panelScenarioId).toBe('checkout')
    expect(ctx.session.inspector.openLink).toHaveBeenCalledWith('checkout', graph, 0, 'Checkout')
    expect(panel.syncWithPanel).toHaveBeenCalled()
    drawn.value = undefined
    views.openLink('checkout', 0)
    views.openLink('missing', 0)
    expect(ctx.session.inspector.openLink).toHaveBeenCalledTimes(1)
  })

  it('showInSequence shows Sequence, moves to the message and opens it', () => {
    diagram.findMessage.mockReturnValue({ id: 'm2' })
    views.showDiagramView('components')
    mounted.add('checkout')
    views.showInSequence('checkout', 'm2')
    expect(area().dataset.view).toBe('sequence')
    expect(diagram.focusDiagramMessage).toHaveBeenCalledWith(document.querySelector('.seq-scroll'), 'm2')
    expect(panel.openMessage).toHaveBeenCalledWith(scenario, { id: 'm2' })
    diagram.findMessage.mockReturnValue(undefined)
    views.showInSequence('checkout', 'gone')
    views.showInSequence('missing', 'm2')
    expect(panel.openMessage).toHaveBeenCalledTimes(1)
  })

  it('focusComponentView focuses the first link, the drawing, or nothing in Sequence', () => {
    expect(views.focusComponentView()).toBe(false)
    views.showDiagramView('components')
    expect(views.focusComponentView()).toBe(true)
    expect(document.activeElement).toBe(document.querySelector('.edge-group'))
    document.querySelector('.edge-group')!.remove()
    const scroller = document.querySelector<HTMLElement>('.comp-scroll')!
    scroller.tabIndex = 0
    expect(views.focusComponentView()).toBe(true)
    expect(document.activeElement).toBe(scroller)
    pane('components').hidden = true
    expect(views.focusComponentView()).toBe(false)
  })
})
