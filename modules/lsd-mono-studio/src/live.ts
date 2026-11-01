import { readFileSync } from 'node:fs'
import { reportAjv } from './import.ts'
import { LIVE_GENERATOR, type ReportStore } from './store.ts'
import { callShares } from './timing.ts'

/** The protocol this server speaks (protocol/lsd-live.schema.json). */
export const LIVE_PROTOCOL = 'lsd-live'
export const LIVE_VERSION = '0.1.0'
export { LIVE_GENERATOR }
export const PROTOCOL_SCHEMA = new URL('../protocol/lsd-live.schema.json', import.meta.url)
/** Close codes: a refused handshake. A finished report closes with 1000. */
export const CLOSE_UNSUPPORTED_VERSION = 4001
export const CLOSE_HELLO_REQUIRED = 4002

const protocolSchema = JSON.parse(readFileSync(PROTOCOL_SCHEMA, 'utf8')) as { $id: string }
reportAjv.addSchema(protocolSchema)
const validateSenderMessage = reportAjv.getSchema(`${protocolSchema.$id}#/$defs/SenderMessage`)!
const validateServerMessage = reportAjv.getSchema(`${protocolSchema.$id}#/$defs/ServerMessage`)!

type Json = Record<string, unknown>
type Status = 'success' | 'warn' | 'error' | 'skipped' | 'aborted'
/** The placeholder scenario's id in a report with no scenarios yet. */
const NO_SCENARIOS = 'no-scenarios'
const RANK: Status[] = ['error', 'warn', 'aborted', 'success', 'skipped']

/** What one message from the sender gets: replies to send, and a close code when the socket should close. */
export interface Outcome {
  replies: Json[]
  close?: number
}

/** Why [message] breaks the protocol, as `path: message` lines; empty when it follows it. */
export function protocolErrors(message: unknown): string[] {
  if (validateSenderMessage(message)) return []
  return (validateSenderMessage.errors ?? []).slice(0, 20).map((e) => `${e.instancePath || '/'}: ${e.message}`)
}

/** Why [reply] is not a server message the protocol allows; empty when it is. */
export function replyErrors(reply: unknown): string[] {
  if (validateServerMessage(reply)) return []
  return (validateServerMessage.errors ?? []).slice(0, 20).map((e) => `${e.instancePath || '/'}: ${e.message}`)
}

/** The major of a semver string. */
const majorOf = (version: string) => Number(version.split('.')[0])

interface Scenario {
  id: string
  title: string
  status?: Status
  error?: Json
  participants: Json[]
  events: Json[]
}

/**
 * Which stored reports are being captured now, and a revision that goes up on each change, so an
 * open report page can tell when to reload (GET /api/reports/:id/live).
 */
export class LiveReports {
  private readonly state = new Map<string, { revision: number; live: boolean }>()

  touch(id: string, live: boolean): void {
    this.state.set(id, { revision: (this.state.get(id)?.revision ?? 0) + 1, live })
  }

  get(id: string): { revision: number; live: boolean } | undefined {
    return this.state.get(id)
  }
}

/**
 * One sender's connection: checks each message against the protocol and builds the live report,
 * stored like an import (source capture) and rewritten after each accepted message.
 */
export class CaptureSession {
  private reportId?: string
  private title = 'Live capture'
  private sender?: string
  private done = false
  private readonly scenarios: Scenario[] = []
  /** Sender errors by scenario id; '' for ones about the whole report, shown on every scenario. */
  private readonly senderErrors: { scenarioId: string; message: string }[] = []

  private readonly store: ReportStore
  private readonly live: LiveReports
  private readonly now: () => Date

  constructor(store: ReportStore, live: LiveReports, now: () => Date = () => new Date()) {
    this.store = store
    this.live = live
    this.now = now
  }

  get id(): string | undefined {
    return this.reportId
  }

  async receive(text: string): Promise<Outcome> {
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch {
      return this.refuse('invalid-json', 'Not JSON')
    }
    const type = (message as Json | null)?.type
    if (this.reportId === undefined && type !== 'hello') {
      return { ...this.refuse('hello-required', 'The first message must be a hello'), close: CLOSE_HELLO_REQUIRED }
    }
    // A hello from a newer major may have any shape, so its version is read before the schema check.
    if (type === 'hello' && this.reportId === undefined) {
      const version = (message as Json).version
      if (typeof version === 'string' && /^\d+\./.test(version) && majorOf(version) !== majorOf(LIVE_VERSION)) {
        return {
          ...this.refuse(
            'unsupported-version',
            `Protocol ${version} is not supported: this server speaks ${LIVE_PROTOCOL} ${LIVE_VERSION} (major ${majorOf(LIVE_VERSION)})`,
          ),
          close: CLOSE_UNSUPPORTED_VERSION,
        }
      }
    }
    const errors = protocolErrors(message)
    if (errors.length > 0) {
      const refused = this.refuse(
        'invalid-message',
        `Not a valid ${typeof type === 'string' ? type : 'protocol'} message`,
        errors,
      )
      return this.reportId === undefined ? { ...refused, close: CLOSE_HELLO_REQUIRED } : refused
    }
    return this.accept(message as Json)
  }

  /** The socket closed: a report that never got report.done stays, marked as cut off. */
  async closed(): Promise<void> {
    if (this.reportId === undefined || this.done) return
    this.done = true
    for (const scenario of this.scenarios) {
      if (scenario.status !== undefined) continue
      scenario.status = 'aborted'
      scenario.error = { headline: 'Capture cut off', message: 'The sender disconnected before the scenario ended.' }
    }
    await this.write()
  }

  private async accept(message: Json): Promise<Outcome> {
    if (this.done) return this.refuse('report-done', 'The report is already done')
    switch (message.type) {
      case 'hello': {
        if (this.reportId !== undefined) return this.refuse('duplicate-hello', 'Already said hello')
        if (typeof message.title === 'string') this.title = message.title
        this.sender = (message.sender as Json | undefined)?.name as string | undefined
        const entry = await this.store.save(this.json(), 'capture')
        this.reportId = entry.id
        this.live.touch(entry.id, true)
        return {
          replies: [
            {
              type: 'welcome',
              protocol: LIVE_PROTOCOL,
              version: LIVE_VERSION,
              reportId: entry.id,
              url: `/reports/${entry.id}`,
            },
          ],
        }
      }
      case 'scenario.start': {
        if (this.find(message.scenarioId) !== undefined) {
          return this.refuse('duplicate-scenario', `Scenario ${String(message.scenarioId)} has already started`)
        }
        this.scenarios.push({
          id: message.scenarioId as string,
          title: message.title as string,
          participants: (message.participants as Json[] | undefined) ?? [],
          events: [],
        })
        break
      }
      case 'event': {
        const scenario = this.open(message.scenarioId)
        if ('replies' in scenario) return scenario
        const event = message.event as Json
        for (const end of [event.from, event.to]) {
          if (typeof end === 'string' && !scenario.participants.some((p) => p.id === end)) {
            scenario.participants.push({ id: end, name: end, type: 'participant' })
          }
        }
        scenario.events.push(event)
        break
      }
      case 'scenario.end': {
        const scenario = this.open(message.scenarioId)
        if ('replies' in scenario) return scenario
        scenario.status = message.status as Status
        if (message.error !== undefined) scenario.error = message.error as Json
        break
      }
      case 'error': {
        this.senderErrors.push({
          scenarioId: (message.scenarioId as string | undefined) ?? '',
          message: message.message as string,
        })
        break
      }
      case 'report.done': {
        this.done = true
        await this.write()
        return { replies: [{ type: 'stored', reportId: this.reportId }], close: 1000 }
      }
    }
    await this.write()
    return { replies: [] }
  }

  private find(id: unknown): Scenario | undefined {
    return this.scenarios.find((scenario) => scenario.id === id)
  }

  /** A started scenario that has not ended, else the refusal to send. */
  private open(id: unknown): Scenario | Outcome {
    const scenario = this.find(id)
    if (scenario === undefined) return this.refuse('unknown-scenario', `No scenario ${String(id)} has started`)
    if (scenario.status !== undefined) return this.refuse('scenario-ended', `Scenario ${String(id)} has ended`)
    return scenario
  }

  private refuse(code: string, message: string, errors?: string[]): Outcome {
    return { replies: [{ type: 'error', code, message, ...(errors && { errors }) }] }
  }

  private async write(): Promise<void> {
    await this.store.replace(this.reportId!, this.json())
    this.live.touch(this.reportId!, !this.done)
  }

  /** The report as it stands. A scenario still running is warn: it has not finished. */
  private json(): string {
    const scenarios: Json[] = this.scenarios.map((s) => {
      const facts = [
        ...(s.status === undefined ? [{ key: 'Live', value: 'still capturing' }] : []),
        ...(this.sender ? [{ key: 'Sender', value: this.sender }] : []),
        ...this.senderErrors
          .filter((e) => e.scenarioId === '' || e.scenarioId === s.id)
          .map((e) => ({ key: 'Sender error', value: e.message })),
      ]
      return {
        id: s.id,
        title: s.title,
        status: s.status ?? 'warn',
        ...(facts.length > 0 && { facts }),
        ...(s.error && { error: s.error }),
        ...(s.participants.length > 0 && { participants: s.participants }),
        ...(s.events.length > 0 && { events: s.events }),
        ...callShares(s.events),
      }
    })
    // A report needs a scenario: until the first one starts (or when none ever does) a placeholder says so.
    if (scenarios.length === 0) {
      scenarios.push(
        this.done
          ? { id: NO_SCENARIOS, title: 'Nothing captured', status: 'skipped' }
          : {
              id: NO_SCENARIOS,
              title: 'Waiting for the first scenario',
              status: 'warn',
              facts: [{ key: 'Live', value: 'still capturing' }],
            },
      )
    }
    const statuses = scenarios.map((s) => s.status as Status)
    return JSON.stringify({
      schemaVersion: '1.0.0',
      title: this.title,
      generatedAt: this.now().toISOString(),
      generator: { name: LIVE_GENERATOR },
      status: RANK.find((status) => statuses.includes(status)) ?? 'success',
      scenarios,
    })
  }
}
