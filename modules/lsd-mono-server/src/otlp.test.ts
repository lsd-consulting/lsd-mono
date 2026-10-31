import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { reportErrors } from './import.ts'
import { OTLP_GENERATOR, otlpToReport } from './otlp.ts'

const CHECKOUT = readFileSync(new URL('../fixtures/otlp/checkout-two-services.json', import.meta.url), 'utf8')
const NOW = new Date('2026-10-31T21:00:00Z')
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'

type Json = Record<string, unknown>

function convert(body: string): Json {
  const result = otlpToReport(body, NOW)
  expect(result.errors).toEqual([])
  return result.report as Json
}

function scenarios(report: Json): Json[] {
  return report.scenarios as Json[]
}

function events(report: Json): Json[] {
  return scenarios(report)[0].events as Json[]
}

/** A minimal one-span export, with overrides on the span and its resource. */
function export1(span: Json | Json[], service = 'svc'): string {
  return JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeSpans: [{ spans: [span].flat() }],
      },
    ],
  })
}

const span = (over: Json = {}): Json => ({
  traceId: TRACE,
  spanId: '00f067aa0ba902b7',
  name: 'GET /x',
  kind: 'SPAN_KIND_SERVER',
  startTimeUnixNano: '1767268800000000000',
  endTimeUnixNano: '1767268800001000000',
  ...over,
})

describe('OTLP to an LSD report', () => {
  it('converts the two-service fixture into a report the schema accepts', () => {
    const report = convert(CHECKOUT)
    expect(reportErrors(JSON.stringify(report))).toEqual([])
    expect(report).toMatchObject({
      schemaVersion: '1.0.0',
      title: 'POST /checkout (trace 4bf92f35)',
      generatedAt: '2026-10-31T21:00:00.000Z',
      generator: { name: OTLP_GENERATOR },
      status: 'error',
    })
  })

  it('makes participants from service.name, a caller, peers and queues', () => {
    expect(scenarios(convert(CHECKOUT))[0].participants).toEqual([
      { id: 'caller', name: 'Caller', type: 'actor' },
      {
        id: 'checkout',
        name: 'checkout',
        type: 'participant',
        attributes: { 'service.name': 'checkout', 'service.version': '1.4.0' },
      },
      { id: 'payments', name: 'payments', type: 'participant', attributes: { 'service.name': 'payments' } },
      {
        id: 'postgresql',
        name: 'postgresql',
        type: 'participant',
        attributes: { 'peer.service': 'postgresql', 'lsd.external': true },
      },
      { id: 'orders-failed', name: 'orders.failed', type: 'queue' },
    ])
  })

  it('pairs client and server spans into calls and replies, nested and in structural order', () => {
    const drawn = events(convert(CHECKOUT)).map((e) => [e.id, e.from, e.to, e.type, e.label, e.parentId ?? e.replyTo])
    expect(drawn).toEqual([
      ['m1', 'caller', 'checkout', 'synchronous', 'POST /checkout · error', undefined],
      ['m2', 'checkout', 'payments', 'synchronous', 'POST /payments · error', 'm1'],
      ['m3', 'payments', 'postgresql', 'synchronous', 'SELECT payments', 'm2'],
      ['m4', 'postgresql', 'payments', 'synchronous_response', 'ok', 'm3'],
      ['m5', 'payments', 'checkout', 'synchronous_response', '500 error', 'm2'],
      ['m6', 'checkout', 'orders-failed', 'asynchronous', 'orders.failed', 'm1'],
      ['m7', 'checkout', 'caller', 'synchronous_response', '502 error', 'm1'],
    ])
  })

  it('keeps trace ids, timing, status and attributes on each message', () => {
    const [, call, , , reply] = events(convert(CHECKOUT))
    expect(call).toMatchObject({
      trace: { traceId: TRACE, spanId: '53995c3f42cd8ad8', parentSpanId: 'a1a1a1a1a1a1a1a1' },
      callId: '53995c3f42cd8ad8',
      durationMs: 83.5,
      startedAt: '2026-01-01T12:00:00.012Z',
      source: 'checkout',
      status: '500',
      timing: 'measured',
      pairing: 'trace',
      origin: 'imported',
    })
    expect(call.attributes).toEqual({
      'http.request.method': 'POST',
      'url.full': 'http://payments:8080/payments',
      'server.address': 'payments',
      'http.response.status_code': 500,
      'http.route': '/payments',
      'lsd.retries': [1, 2],
      'lsd.span.kind': 'CLIENT',
    })
    expect(reply).toMatchObject({ replyTo: 'm2', callId: '53995c3f42cd8ad8', status: '500', pairing: 'trace' })
  })

  it('fails the scenario on an error span and counts the spans it does not draw', () => {
    const [scenario] = scenarios(convert(CHECKOUT))
    expect(scenario).toMatchObject({
      id: `trace-${TRACE}`,
      status: 'error',
      error: { headline: 'POST /checkout failed', message: 'Payment failed' },
      accuracy: 'traced',
      sources: ['checkout', 'payments'],
    })
    expect(scenario.facts).toEqual([
      { key: 'traceId', value: TRACE },
      { key: 'Spans', value: '6' },
      { key: 'Services', value: 'checkout, payments' },
      { key: 'Internal spans not drawn', value: '1' },
    ])
  })

  it('makes one scenario per trace, earliest first', () => {
    const other = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const report = convert(
      export1([
        span({ startTimeUnixNano: '2000', endTimeUnixNano: '3000' }),
        span({ traceId: other, startTimeUnixNano: '1000' }),
      ]),
    )
    expect(scenarios(report).map((s) => s.id)).toEqual([`trace-${other}`, `trace-${TRACE}`])
    expect(report.title).toBe('2 imported traces')
    expect(report.status).toBe('success')
    expect(reportErrors(JSON.stringify(report))).toEqual([])
  })

  it('pairs a producer with its consumers and lets a lone consumer read from its queue', () => {
    const producer = span({ kind: 'SPAN_KIND_PRODUCER', name: 'send', attributes: [] })
    const consumer = {
      traceId: TRACE,
      spanId: 'b2b2b2b2b2b2b2b2',
      parentSpanId: '00f067aa0ba902b7',
      name: 'receive',
      kind: 5,
      startTimeUnixNano: '1767268800002000000',
      endTimeUnixNano: '1767268800003000000',
    }
    const lone = {
      ...consumer,
      spanId: 'c3c3c3c3c3c3c3c3',
      parentSpanId: undefined,
      startTimeUnixNano: '1767268800009000000',
    }
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'a' } }] },
          scopeSpans: [{ spans: [producer] }],
        },
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'b' } }] },
          scopeSpans: [{ spans: [consumer, lone] }],
        },
      ],
    })
    const report = convert(body)
    expect(events(report).map((e) => [e.from, e.to, e.type, e.label, e.pairing])).toEqual([
      ['a', 'b', 'asynchronous', 'receive', 'trace'],
      ['receive', 'b', 'asynchronous', 'receive', undefined],
    ])
    expect(reportErrors(JSON.stringify(report))).toEqual([])
  })

  it('sends a producer with no consumer to its queue and a client with no server to a remote', () => {
    const report = convert(
      export1([
        span({
          kind: 'SPAN_KIND_PRODUCER',
          attributes: [{ key: 'messaging.destination.name', value: { stringValue: 'q' } }],
        }),
        span({
          spanId: 'b2b2b2b2b2b2b2b2',
          kind: 'SPAN_KIND_CLIENT',
          name: 'call it',
          startTimeUnixNano: '1767268800005000000',
        }),
      ]),
    )
    expect(events(report).map((e) => [e.from, e.to, e.label])).toEqual([
      ['svc', 'q', 'q'],
      ['svc', 'call-it-remote', 'call it'],
      ['call-it-remote', 'svc', 'ok'],
    ])
  })

  it('labels RPC calls, falls back to the span name, and reads numeric enums', () => {
    const rpc = convert(
      export1(
        span({
          kind: 2,
          status: { code: 2 },
          attributes: [
            { key: 'rpc.service', value: { stringValue: 'Pay' } },
            { key: 'rpc.method', value: { stringValue: 'Charge' } },
          ],
        }),
      ),
    )
    expect(events(rpc).map((e) => e.label)).toEqual(['Pay/Charge · error', 'error'])
    expect(scenarios(rpc)[0].error).toEqual({ headline: 'GET /x failed', message: 'The svc span has status ERROR.' })
  })

  it('calls a server from the service of an internal parent in another service', () => {
    const body = JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'a' } }] },
          scopeSpans: [{ spans: [span({ kind: 'SPAN_KIND_INTERNAL', spanId: 'a1a1a1a1a1a1a1a1' })] }],
        },
        {
          resource: { attributes: [] },
          scopeSpans: [{ spans: [span({ parentSpanId: 'a1a1a1a1a1a1a1a1' })] }],
        },
      ],
    })
    expect(events(convert(body)).map((e) => [e.from, e.to])).toEqual([
      ['a', 'unknown-service'],
      ['unknown-service', 'a'],
    ])
  })

  it('keeps an end before the start at zero duration and ignores attributes it cannot carry', () => {
    const report = convert(
      export1(
        span({
          endTimeUnixNano: '1',
          attributes: [
            { key: 'mixed', value: { arrayValue: { values: [{ stringValue: 'x' }, { intValue: '1' }] } } },
            { key: 'map', value: { kvlistValue: { values: [] } } },
            { key: 'flag', value: { boolValue: true } },
            { key: 'ratio', value: { doubleValue: 0.5 } },
            { value: { stringValue: 'no key' } },
            'junk',
          ],
        }),
      ),
    )
    expect(events(report)[0]).toMatchObject({
      durationMs: 0,
      attributes: { flag: true, ratio: 0.5, 'lsd.span.kind': 'SERVER' },
    })
    expect(reportErrors(JSON.stringify(report))).toEqual([])
  })

  it('refuses what is not a trace export, with a path for each problem', () => {
    expect(otlpToReport('nope').errors).toEqual(['/: must be JSON'])
    expect(otlpToReport('[]').errors).toEqual(['/: must be an object'])
    expect(otlpToReport('{"resourceSpans":[]}').errors).toEqual(['/resourceSpans: has no spans'])
    expect(otlpToReport('{"resourceSpans":{}}').errors).toEqual(['/resourceSpans: must be an array'])
    expect(otlpToReport('{"resourceSpans":[1]}').errors).toEqual(['/resourceSpans/0: must be an object'])
    const bad = export1(
      span({
        traceId: 'AAE=',
        spanId: 'x',
        parentSpanId: 'y',
        startTimeUnixNano: 1.5,
        endTimeUnixNano: 'soon',
        name: 3,
        kind: 'ODD',
      }),
    )
    expect(otlpToReport(bad).errors).toEqual([
      '/resourceSpans/0/scopeSpans/0/spans/0/traceId: must be 32 hex characters',
      '/resourceSpans/0/scopeSpans/0/spans/0/spanId: must be 16 hex characters',
      '/resourceSpans/0/scopeSpans/0/spans/0/parentSpanId: must be 16 hex characters',
      '/resourceSpans/0/scopeSpans/0/spans/0/startTimeUnixNano: must be nanoseconds since the epoch, as a string of digits',
      '/resourceSpans/0/scopeSpans/0/spans/0/endTimeUnixNano: must be nanoseconds since the epoch, as a string of digits',
      '/resourceSpans/0/scopeSpans/0/spans/0/name: must be a string',
      '/resourceSpans/0/scopeSpans/0/spans/0/kind: must be a span kind',
    ])
  })

  it('lists at most 50 problems', () => {
    const spans = Array.from({ length: 60 }, () => span({ traceId: 'x' }))
    expect(otlpToReport(export1(spans)).errors).toHaveLength(50)
  })
})
