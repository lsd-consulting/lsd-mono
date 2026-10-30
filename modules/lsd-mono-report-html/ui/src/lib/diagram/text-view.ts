import type { DiagramEvent, KnownMessageType, MessageEvent, Scenario } from '../../types'
import { escapeHtml } from '../escape'
import { eventHiddenByColumns } from '../diagram-view'
import { messageHasPayload } from '../diagram-a11y'
import { isErrorStatus } from '../status'

// A type this UI does not know (from a newer producer) reads as a message.
const KIND: Record<KnownMessageType, string> & Partial<Record<string, string>> = {
  synchronous: 'call',
  synchronous_response: 'reply',
  asynchronous: 'async',
  lost: 'lost message',
  bi_directional: 'two-way',
  short_inbound: 'inbound',
  short_outbound: 'outbound',
}

/** Call, reply, async, self call and so on, as a person would say it. */
export function messageKind(msg: MessageEvent): string {
  if (msg.from && msg.from === msg.to) return msg.type === 'synchronous_response' ? 'self reply' : 'self call'
  return KIND[msg.type] ?? 'message'
}

/**
 * One message as a sentence (`labelFirst` puts the label first, for a button's name, so voice control hears it first): "Web UI to Gateway, call: POST /checkout, 586 ms, status 200, has payload".
 * The drawing is hidden from assistive tech, so this carries everything the arrow shows.
 */
export function messageSpeech(
  msg: MessageEvent,
  participants: { id: string; name: string }[],
  labelFirst = false,
): string {
  const name = (id: string) => participants.find((p) => p.id === id)?.name ?? id
  const ends =
    msg.type === 'short_inbound'
      ? `to ${name(msg.to)}`
      : msg.type === 'short_outbound'
        ? `from ${name(msg.from)}`
        : `${name(msg.from)} to ${name(msg.to)}`
  const parts = labelFirst ? [msg.label, ends, messageKind(msg)] : [`${ends}, ${messageKind(msg)}: ${msg.label}`]
  if (msg.durationMs != null) parts.push(`${msg.durationMs} ms`)
  if (msg.status) parts.push(`${isErrorStatus(msg.status) ? 'error, ' : ''}status ${msg.status}`)
  if (messageHasPayload(msg)) parts.push('has payload')
  return parts.join(', ')
}

function itemHtml(event: DiagramEvent, scenario: Scenario): string {
  switch (event.kind) {
    case 'message':
      return `<li>${escapeHtml(messageSpeech(event, scenario.participants))}</li>`
    case 'section':
      return `<li><h4>${escapeHtml(event.title)}</h4></li>`
    case 'note':
      return `<li>Note: ${escapeHtml(event.text)}</li>`
    case 'divider':
      return `<li>Divider: ${escapeHtml(event.label)}</li>`
    default:
      return ''
  }
}

/**
 * The whole diagram as an ordered text list, in drawn order (`events` from the layout rows), outside the virtual window so every
 * message is in the accessibility tree whether or not its row is painted. Visually hidden.
 */
export function textViewHtml(scenario: Scenario, events: DiagramEvent[], hiddenIds: ReadonlySet<string>): string {
  const items = events
    .filter((event) => event.kind !== 'message' || !eventHiddenByColumns(event, hiddenIds))
    .map((event) => itemHtml(event, scenario))
    .join('')
  if (!items) return ''
  return `<ol class="msg-text visually-hidden" aria-label="Messages in order">${items}</ol>`
}
