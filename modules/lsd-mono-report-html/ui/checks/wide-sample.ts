import { REPORT_SCHEMA_VERSION, type MessageEvent, type NoteEvent, type Participant, type Report } from '../src/types'
import { untimed } from '../src/lib/report-fixture.test-util'

/**
 * The wide-participant perf sample, shared by docs/perf/generate-wide.mjs (which adds the payloads
 * and writes the pages) and the check:ux tests that open it. Erasable TypeScript only: the
 * generator runs it with `node --experimental-strip-types`.
 *
 * The first arrow is a short left-hand hop so the default view's top label stays near the origin. Later arrows
 * hop across the diagram, including a full-width span every 25th message.
 */
const KINDS: { type: Participant['type']; name: string }[] = [
  { type: 'actor', name: 'User' },
  { type: 'database', name: 'Orders' },
  { type: 'queue', name: 'Queue' },
  { type: 'participant', name: 'Api' },
  { type: 'entity', name: 'Entity' },
  { type: 'boundary', name: 'Edge' },
]

export function wideParticipants(count: number): Participant[] {
  return Array.from({ length: count }, (_, i) => {
    const kind = KINDS[i % KINDS.length]
    const n = String(i + 1).padStart(2, '0')
    return { id: `p${n}`, name: `${kind.name} ${n}`, type: kind.type }
  })
}

export function wideStep(i: number, count: number): { from: number; to: number; label: string } {
  const from = i % count
  if (i % 25 === 24) return { from, to: count - 1, label: 'span all' }
  const hop = 1 + (i % Math.max(1, count - 1))
  let to = (from + hop) % count
  if (to === from) to = (from + 1) % count
  return { from, to, label: hop > count / 2 ? 'cross' : 'hop' }
}

/** [payload] gives a message's data; the check:ux tests leave it out. */
export function wideReport(
  count: number,
  size: number,
  payload: (step: { label: string }, id: number) => unknown = () => undefined,
): Report {
  const participants = wideParticipants(count)
  const events: (MessageEvent | NoteEvent)[] = []
  for (let i = 0; i < size; i++) {
    const step = wideStep(i, count)
    const id = i + 1
    const type = id % 4 === 0 ? 'synchronous_response' : 'synchronous'
    const event: MessageEvent = {
      kind: 'message',
      id: String(id),
      from: participants[step.from].id,
      to: participants[step.to].id,
      label: step.label,
      type,
    }
    const data = payload(step, id)
    if (data !== undefined) event.data = data
    if (id % 4 === 2) event.durationMs = 15
    // Every fourth message replies to the one before it (its arrow keeps the hop pattern).
    if (type === 'synchronous_response') event.replyTo = String(id - 1)
    events.push(event)
  }
  events.push({
    kind: 'note',
    id: String(size + 1),
    text: `needle-p${count}-m${size}`,
    over: participants[0].id,
    placement: 'over',
  })
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    title: `mono-p${count}-m${size}`,
    generatedAt: new Date().toISOString(),
    generator: { name: 'lsd-mono-jvm wide perf fixture' },
    status: 'success',
    options: { metricsEnabled: true, labelMaxChars: 200, usagePing: false, source: 'api' },
    scenarios: [
      {
        ...untimed(),
        // Every fourth message has a duration, so the Timing view has something to show.
        accuracy: 'measured',
        id: `wide-p${count}-m${size}`,
        title: `${count} participants, ${size} messages`,
        status: 'success',
        description: 'Synthetic wide-participant perf fixture. Payloads load when the inspector opens.',
        facts: [],
        metrics: [
          { key: 'Participants', value: String(count) },
          { key: 'Messages', value: String(size) },
        ],
        participants,
        events,
      },
    ],
  }
}
