// A newer producer may send a participant type, message type or event kind this UI does not know
// (the schema's open enums): the diagram falls back as the schema says, and markup stays escaped.
import { describe, expect, it } from 'vitest'
import { messageArrowSpec, participantHeadFor } from './diagram/shapes'
import { messageKind } from './diagram/text-view'
import { normaliseScenario } from './report-normalise'
import { renderDiagramHtml } from './sequence-diagram'
import type { DiagramEvent, MessageEvent, Scenario, ScenarioJson } from '../types'
import { DEFAULT_LABEL_MAX_CHARS } from '../ui/format'

const newer = '"><img src=x onerror=alert(1)>'
const message: MessageEvent = { kind: 'message', id: 'm1', from: 'a', to: 'b', label: 'ping', type: 'BROADCAST' }

function scenario(events: DiagramEvent[]): Scenario {
  return normaliseScenario({
    id: 's1',
    title: 'Newer',
    status: 'success',
    participants: [
      { id: 'a', name: 'A', type: newer },
      { id: 'b', name: 'B', type: 'ROBOT' },
    ],
    events: events as ScenarioJson['events'],
  })
}

describe('values from a newer producer', () => {
  it('draws an unknown message type as a call', () => {
    expect(messageArrowSpec('BROADCAST')).toEqual(messageArrowSpec('synchronous'))
    expect(messageKind(message)).toBe('message')
  })

  it('draws an unknown participant type as a plain participant, and never as markup', () => {
    expect(participantHeadFor({ name: 'B', type: 'ROBOT' })).toMatchObject({
      type: 'participant',
      typeLabel: 'component',
    })
    const html = renderDiagramHtml(scenario([message]), DEFAULT_LABEL_MAX_CHARS)
    expect(html).not.toContain('ROBOT')
    expect(html).not.toContain('<img')
  })

  it('leaves out an event of an unknown kind', () => {
    const hologram = { kind: 'hologram', id: 'h1', label: 'never drawn' } as unknown as DiagramEvent
    const html = renderDiagramHtml(scenario([message, hologram]), DEFAULT_LABEL_MAX_CHARS)
    expect(html).not.toContain('never drawn')
    expect(html).toContain('ping')
  })
})
