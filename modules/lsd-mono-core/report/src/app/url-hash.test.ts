// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// writeScenarioHash: the shown scenario, and &view=components only while a Components view is shown (#105).
const hash = vi.hoisted(() => ({ writeReportHash: vi.fn() }))
interface Context {
  session: Record<string, unknown>
  state: { selectedId: string | null }
}
const ctx = vi.hoisted((): Context => ({ session: {}, state: { selectedId: 'checkout' } }))
vi.mock('../lib/report-hash', () => hash)
vi.mock('./context', () => ({
  index: null,
  get session() {
    return ctx.session
  },
  get state() {
    return ctx.state
  },
}))

const { dropUnshownView, writeScenarioHash } = await import('./url-hash')
const written = (): unknown => hash.writeReportHash.mock.calls.at(-1)![1] as unknown

beforeEach(() => {
  vi.clearAllMocks()
  ctx.session = { diagramView: 'components' }
  ctx.state.selectedId = 'checkout'
  document.body.innerHTML = '<main id="main"><div class="diagram-pane" data-pane="components"></div></main>'
})

describe('writeScenarioHash', () => {
  it('writes the Components view while the card has one', () => {
    writeScenarioHash()
    expect(written()).toEqual({ scenarioId: 'checkout', view: 'components' })
  })

  it('writes Sequence as no view, and so a card with no Components view', () => {
    ctx.session.diagramView = 'sequence'
    writeScenarioHash()
    expect(written()).toEqual({ scenarioId: 'checkout' })
    ctx.session.diagramView = 'components'
    document.body.innerHTML = '<main id="main"></main>'
    writeScenarioHash()
    expect(written()).toEqual({ scenarioId: 'checkout' })
  })

  it('clears the hash with nothing selected', () => {
    ctx.state.selectedId = null
    writeScenarioHash()
    expect(written()).toBeNull()
  })
})

describe('dropUnshownView', () => {
  it('takes &view=components out when the card shown has no Components view', () => {
    window.location.hash = '#scenario=checkout&view=components'
    document.body.innerHTML = '<main id="main"></main>'
    dropUnshownView()
    expect(written()).toEqual({ scenarioId: 'checkout' })
  })

  it('leaves the URL alone when Components is shown, or a message is open', () => {
    window.location.hash = '#scenario=checkout&view=components'
    dropUnshownView()
    document.body.innerHTML = '<main id="main"></main>'
    ctx.session.panelScenarioId = 'checkout'
    dropUnshownView()
    expect(hash.writeReportHash).not.toHaveBeenCalled()
  })
})
