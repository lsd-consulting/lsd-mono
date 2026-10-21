// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// revealMessage (#105): a message lives in the Sequence view, so it is shown before the scroll.
const order: string[] = []
const nav = vi.hoisted(() => ({ renderNav: vi.fn(), selectScenario: vi.fn() }))
const views = vi.hoisted(() => ({
  bindDiagramTabs: vi.fn(),
  focusComponentView: vi.fn(),
  openLink: vi.fn(),
  pingShownView: vi.fn(),
  showDiagramView: vi.fn(),
}))
const pageScroll = vi.hoisted(() => ({ scrollDiagramToOffset: vi.fn() }))
const diagram = vi.hoisted(() => ({
  bindDiagramScroll: vi.fn(),
  diagramView: vi.fn(() => ({ zoom: 2 })),
  messageOffsetY: vi.fn((): number | null => 100),
  syncDiagramWindow: vi.fn(),
}))
const ctx = vi.hoisted((): { session: Record<string, unknown> } => ({ session: {} }))
vi.mock('./nav', () => nav)
vi.mock('./diagram-views', () => views)
vi.mock('../lib/diagram/page-scroll', () => pageScroll)
vi.mock('../lib/sequence-diagram', () => diagram)
vi.mock('./scenario-card', () => ({ heroHtml: () => '', scenarioHtml: () => '' }))
vi.mock('./panel', () => ({ syncWithPanel: vi.fn() }))
vi.mock('./filters', () => ({ filtered: () => [] }))
vi.mock('./url-hash', () => ({ writeScenarioHash: vi.fn() }))
vi.mock('../lib/component-view', () => ({ bindComponentViews: vi.fn() }))
vi.mock('./context', () => ({
  index: null,
  state: {},
  get session() {
    return ctx.session
  },
}))

const { revealMessage } = await import('./main-view')

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  views.showDiagramView.mockImplementation((view: string) => order.push(`show ${view}`))
  pageScroll.scrollDiagramToOffset.mockImplementation((_scroll: HTMLElement, y: number) => order.push(`scroll ${y}`))
  ctx.session = { report: { scenarios: [{ id: 'checkout' }] }, renderedId: 'checkout' }
  document.body.innerHTML =
    '<article id="card-checkout"><div class="seq-diagram"><div class="seq-scroll"></div></div></article>'
})

describe('revealMessage', () => {
  it('shows Sequence first, then scrolls its diagram to the message', () => {
    revealMessage('checkout', 'm1')
    expect(views.showDiagramView).toHaveBeenCalledWith('sequence', false)
    expect(order).toEqual(['show sequence', 'scroll 176'])
    expect(nav.selectScenario).not.toHaveBeenCalled()
    expect(diagram.syncDiagramWindow).toHaveBeenCalled()
  })

  it('selects another scenario first, and does nothing for one not in the report', () => {
    ctx.session.renderedId = 'other'
    revealMessage('checkout', 'm1')
    expect(nav.selectScenario).toHaveBeenCalledWith('checkout')
    vi.clearAllMocks()
    revealMessage('missing', 'm1')
    expect(views.showDiagramView).not.toHaveBeenCalled()
  })
})
