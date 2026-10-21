// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Scenario } from '../types'
import { bindInspector, inspectorMarkup } from '../ui/inspector'
import { parseReportHash, writeReportHash } from './report-hash'
import { untimed } from './report-fixture.test-util'

const scenario: Scenario = {
  ...untimed(),
  id: 'sc-happy',
  title: 'Happy',
  status: 'success',
  description: '',
  facts: [],
  metrics: [],
  participants: [
    { id: 'a', name: 'A', type: 'PARTICIPANT' },
    { id: 'b', name: 'B', type: 'PARTICIPANT' },
  ],
  events: Array.from({ length: 40 }, (_, i) => ({
    kind: 'message' as const,
    id: `m${i + 1}`,
    from: 'a',
    to: 'b',
    label: `hop ${i + 1}`,
    type: 'SYNCHRONOUS' as const,
    data: { method: 'POST', path: `/${i + 1}`, status: 200 },
  })),
}

describe('open message in the URL', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="shell">
        <button type="button" class="msg-open" data-message-id="m1">arrow</button>
        ${inspectorMarkup()}
      </div>`
    ;(window as unknown as { locationHash: string }).locationHash = ''
  })

  it('writes the message hash on open and goes back to the scenario hash on close', () => {
    const loc = {
      hash: '',
      replace(url: string) {
        this.hash = url === '#' ? '' : url
      },
    }
    const message = scenario.events[0]
    if (message.kind !== 'message') throw new Error('expected message')
    const controller = bindInspector(document, {
      loadPayload: async () => ({ body: 'lazy' }),
      onClose: () => writeReportHash(loc, { scenarioId: scenario.id }),
    })
    writeReportHash(loc, { scenarioId: scenario.id, messageId: message.id })
    controller.openMessage(scenario.id, message)
    expect(parseReportHash(loc.hash)).toEqual({ scenarioId: 'sc-happy', messageId: 'm1' })
    controller.close()
    // Closing the panel keeps the scenario in the URL.
    expect(parseReportHash(loc.hash)).toEqual({ scenarioId: 'sc-happy' })
  })
})
