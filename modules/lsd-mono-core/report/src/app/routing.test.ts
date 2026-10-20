// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// applyHash's branches, without the report around it: what it opens for each hash.
const nav = vi.hoisted(() => ({ openReport: vi.fn(), revealFiltered: vi.fn(), selectScenario: vi.fn() }))
const panel = vi.hoisted(() => ({ openMessage: vi.fn() }))
const diagram = vi.hoisted(() => ({ findMessage: vi.fn(), focusDiagramMessage: vi.fn() }))
interface Context {
  index: null | { reports: { id: string }[] }
  session: Record<string, unknown>
}
const ctx = vi.hoisted((): Context => ({ index: null, session: {} }))

vi.mock('./nav', () => nav)
vi.mock('./panel', () => panel)
vi.mock('../lib/sequence-diagram', () => diagram)
vi.mock('./filters', () => ({ indexEntry: (id: string) => ctx.index?.reports.find((r) => r.id === id) }))
vi.mock('../lib/report-index', () => ({ defaultReportId: () => 'first' }))
const views = vi.hoisted(() => ({ showDiagramView: vi.fn() }))
vi.mock('./diagram-views', () => views)
vi.mock('./context', () => ({
  get index() {
    return ctx.index
  },
  get session() {
    return ctx.session
  },
}))

const { applyHash, applyRef } = await import('./routing')

const scenario = { id: 'checkout', events: [] }

beforeEach(() => {
  vi.clearAllMocks()
  ctx.index = null
  ctx.session = { report: { scenarios: [scenario] }, renderedId: null, booted: true }
  diagram.findMessage.mockReturnValue({ id: 'm1' })
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => run())
  window.location.hash = ''
})

describe('applyHash', () => {
  it('does nothing while the app writes the hash itself', () => {
    ctx.session.writingHash = true
    window.location.hash = '#checkout'
    applyHash()
    expect(nav.selectScenario).not.toHaveBeenCalled()
  })

  it('shows the scenario a single report hash names, and opens its message', () => {
    window.location.hash = '#msg=checkout/m1'
    applyHash()
    expect(nav.revealFiltered).toHaveBeenCalledWith('checkout')
    expect(nav.selectScenario).toHaveBeenCalledWith('checkout')
    expect(panel.openMessage).toHaveBeenCalledWith(scenario, { id: 'm1' })
  })

  it('ignores an empty hash and a scenario that is not in the report', () => {
    applyHash()
    window.location.hash = '#scenario=nowhere'
    applyHash()
    expect(nav.selectScenario).not.toHaveBeenCalled()
  })

  it('opens the default report when the index hash names none, and a named one when it exists', () => {
    ctx.index = { reports: [{ id: 'first' }, { id: 'second' }] }
    applyHash()
    expect(nav.openReport).toHaveBeenLastCalledWith('first', undefined, true)
    ctx.session.reportId = 'first'
    window.location.hash = '#report=second'
    applyHash()
    expect(nav.openReport).toHaveBeenLastCalledWith('second', expect.objectContaining({ reportId: 'second' }), true)
  })

  it('stays on the open report when the hash names an unknown one', () => {
    ctx.index = { reports: [{ id: 'first' }] }
    ctx.session.reportId = 'first'
    window.location.hash = '#report=gone'
    applyHash()
    expect(nav.openReport).not.toHaveBeenCalled()
    expect(nav.selectScenario).not.toHaveBeenCalled()
  })
})

describe('applyRef', () => {
  it('does not reopen the message the panel already shows, but still focuses it', () => {
    ctx.session.renderedId = 'checkout'
    ctx.session.inspector = { isOpen: () => true }
    ctx.session.invoker = { scenarioId: 'checkout', messageId: 'm1' }
    document.body.innerHTML = '<div id="card-checkout"><div class="seq-scroll"></div></div>'
    applyRef({ scenarioId: 'checkout', messageId: 'm1' })
    expect(nav.selectScenario).not.toHaveBeenCalled()
    expect(diagram.focusDiagramMessage).toHaveBeenCalledWith(document.querySelector('.seq-scroll'), 'm1')
    expect(panel.openMessage).not.toHaveBeenCalled()
  })

  it('sets the view the hash names before drawing, or shows it on the scenario already drawn (#105)', () => {
    applyRef({ scenarioId: 'checkout', view: 'components' })
    expect(ctx.session.diagramView).toBe('components')
    expect(nav.selectScenario).toHaveBeenCalledWith('checkout')
    expect(views.showDiagramView).not.toHaveBeenCalled()
    ctx.session.renderedId = 'checkout'
    applyRef({ scenarioId: 'checkout' })
    expect(ctx.session.diagramView).toBe('sequence')
    expect(views.showDiagramView).toHaveBeenCalledWith('sequence', false)
    // A message is in Sequence, whatever the hash says.
    applyRef({ scenarioId: 'checkout', messageId: 'm1', view: 'components' })
    expect(ctx.session.diagramView).toBe('sequence')
  })

  it('stops at the scenario when the message is not in it', () => {
    diagram.findMessage.mockReturnValue(undefined)
    applyRef({ scenarioId: 'checkout', messageId: 'gone' })
    expect(nav.selectScenario).toHaveBeenCalledWith('checkout')
    expect(panel.openMessage).not.toHaveBeenCalled()
  })
})
