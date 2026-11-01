import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reportErrors } from './import.ts'
import { CaptureSession, LiveReports, protocolErrors, type Outcome } from './live.ts'
import { FileReportStore } from './store.ts'

/** The shared contract: protocol/fixtures/manifest.json and the streams it lists. */
interface Expected {
  replies: { line: number; type: string; code?: string }[]
  close?: number
  report?: { title: string; status: string; scenarios: { id: string; status: string; events: number }[] }
}
interface Stream {
  file: string
  valid: boolean
  about: string
  expect: Expected
}
const FIXTURES = new URL('../protocol/fixtures/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', FIXTURES), 'utf8')) as { streams: Stream[] }
const streamLines = (file: string) =>
  readFileSync(new URL(file, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line !== '')

/** Sends each line until the session asks to close, as the server does; then the socket closes. */
async function replay(session: CaptureSession, lines: string[]) {
  const replies: { line: number; type: string; code?: string }[] = []
  let close: number | undefined
  for (const [index, line] of lines.entries()) {
    const outcome: Outcome = await session.receive(line)
    for (const reply of outcome.replies) {
      replies.push({
        line: index + 1,
        type: reply.type as string,
        ...(reply.code !== undefined && { code: reply.code as string }),
      })
    }
    if (outcome.close !== undefined) {
      close = outcome.close
      break
    }
  }
  await session.closed()
  return { replies, close }
}

describe('the live capture protocol', () => {
  let dir: string
  let store: FileReportStore
  let live: LiveReports

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lsd-live-'))
    store = new FileReportStore(dir)
    live = new LiveReports()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('lists every stream in the fixtures folder', async () => {
    const { readdir } = await import('node:fs/promises')
    const files = (await readdir(new URL('streams/', FIXTURES))).map((f) => `streams/${f}`).sort()
    expect(manifest.streams.map((s) => s.file).sort()).toEqual(files)
  })

  describe.each(manifest.streams)('$file: $about', (stream) => {
    it('gets the expected replies and close', async () => {
      const result = await replay(new CaptureSession(store, live), streamLines(stream.file))
      expect(result.replies).toEqual(stream.expect.replies)
      expect(result.close).toBe(stream.expect.close)
    })

    it(stream.expect.report ? 'stores a valid report' : 'stores nothing', async () => {
      const session = new CaptureSession(store, live)
      await replay(session, streamLines(stream.file))
      const expected = stream.expect.report
      if (!expected) {
        expect(await store.list()).toEqual([])
        return
      }
      const [entry] = await store.list()
      expect(entry).toMatchObject({ id: session.id, source: 'capture', title: expected.title })
      const json = (await store.get(entry.id))!
      expect(reportErrors(json)).toEqual([])
      const report = JSON.parse(json) as {
        status: string
        scenarios: { id: string; status: string; events?: unknown[] }[]
      }
      expect(report.status).toBe(expected.status)
      expect(report.scenarios.map((s) => ({ id: s.id, status: s.status, events: s.events?.length ?? 0 }))).toEqual(
        expected.scenarios,
      )
      expect(live.get(entry.id)?.live).toBe(false)
    })

    if (stream.valid) {
      it('is made of messages the protocol schema accepts', () => {
        for (const line of streamLines(stream.file)) expect(protocolErrors(JSON.parse(line))).toEqual([])
      })
    }
  })

  it('shows a report while it is captured, and bumps its revision on each message', async () => {
    const session = new CaptureSession(store, live, () => new Date('2026-11-01T11:00:00Z'))
    const lines = streamLines('streams/checkout.jsonl')
    for (const line of lines.slice(0, 3)) await session.receive(line)
    const id = session.id!
    expect(live.get(id)).toEqual({ revision: 3, live: true })
    const report = JSON.parse((await store.get(id))!) as { status: string; scenarios: Record<string, unknown>[] }
    expect(reportErrors(JSON.stringify(report))).toEqual([])
    expect(report.status).toBe('warn')
    expect(report.scenarios[0]).toMatchObject({
      status: 'warn',
      facts: [
        { key: 'Live', value: 'still capturing' },
        { key: 'Sender', value: 'fixture' },
      ],
    })
  })

  it('names the sender errors on the scenarios they are about', async () => {
    const session = new CaptureSession(store, live)
    for (const line of streamLines('streams/sender-error.jsonl')) await session.receive(line)
    const report = JSON.parse((await store.get(session.id!))!) as { scenarios: { facts: unknown[] }[] }
    expect(report.scenarios[0].facts).toEqual([
      { key: 'Sender', value: 'fixture' },
      { key: 'Sender error', value: 'Could not read the response body' },
      { key: 'Sender error', value: 'Clock skew detected' },
    ])
  })

  it('adds participants an event names that the scenario did not declare', async () => {
    const session = new CaptureSession(store, live)
    for (const line of streamLines('streams/newer-minor.jsonl')) await session.receive(line)
    const report = JSON.parse((await store.get(session.id!))!) as { scenarios: { participants: unknown[] }[] }
    expect(report.scenarios[0].participants).toEqual([
      { id: 'a', name: 'a', type: 'participant' },
      { id: 'b', name: 'b', type: 'participant' },
    ])
  })

  it('explains why a message breaks the protocol', async () => {
    const session = new CaptureSession(store, live)
    await session.receive(streamLines('streams/checkout.jsonl')[0])
    const outcome = await session.receive(JSON.stringify({ type: 'scenario.start', scenarioId: 's' }))
    expect(outcome.replies[0]).toMatchObject({ code: 'invalid-message', message: 'Not a valid scenario.start message' })
    expect(outcome.replies[0].errors).toEqual(expect.arrayContaining([expect.stringMatching(/title/)]))
    expect((await session.receive('null')).replies[0]).toMatchObject({ code: 'invalid-message' })
  })

  it('refuses everything after report.done', async () => {
    const session = new CaptureSession(store, live)
    for (const line of streamLines('streams/minimal.jsonl')) await session.receive(line)
    expect((await session.receive('{"type":"report.done"}')).replies[0]).toMatchObject({ code: 'report-done' })
  })

  it('holds a placeholder scenario until the first one starts', async () => {
    const session = new CaptureSession(store, live)
    await session.receive(streamLines('streams/minimal.jsonl')[0])
    const json = (await store.get(session.id!))!
    expect(reportErrors(json)).toEqual([])
    expect((JSON.parse(json) as { scenarios: unknown[] }).scenarios).toEqual([
      {
        id: 'no-scenarios',
        title: 'Waiting for the first scenario',
        status: 'warn',
        facts: [{ key: 'Live', value: 'still capturing' }],
      },
    ])
  })

  it('stores nothing when the socket closes before a hello', async () => {
    await new CaptureSession(store, live).closed()
    expect(await store.list()).toEqual([])
  })
})
