# lsd-mono-report-schema

Part of [LSD: living sequence diagrams](../../README.md). An internal building block: most users depend on [`lsd-mono-jvm`](../lsd-mono-jvm/README.md) or a framework module instead.

JSON Schemas (2020-12) for the report data lsd-mono writes, so the format is owned by neither the
Kotlin writer nor the TypeScript report UI:

| File | Describes | Written as |
|------|-----------|------------|
| `lsd-report.schema.json` | One report | `<stem>-report.json`; `window.__LSD_REPORT__` in `<stem>-diagram.html`; the `report` in `<stem>-report.js` |
| `lsd-index.schema.json` | The index manifest | `window.__LSD_INDEX__` in `index.html` |

This is a plain directory, not a Gradle project or a published artifact (yet).

## Versions

**Stable from 1.0.0.** The format is frozen at 1.0.0: from here, a minor version only adds and
anything else takes a new major version. How it lines up with OpenTelemetry is decided
([below](#opentelemetry)): additively, with no OpenTelemetry dependency.

- Every report and index has a required `schemaVersion`: the semver of the schema it follows,
  apart from the lsd-mono version. This is `1.0.0`.
- The version is in each schema's `$id`
  (`https://lsd-consulting.github.io/lsd-mono/schema/1.0.0/lsd-report.schema.json`), and each
  schema is published at its `$id` by the Pages workflow (`.github/workflows/pages.yml`), so a
  validator can fetch it. This directory is the source; the published copy is made from it.
- **A minor version only adds**: a new optional field, a new value of an open enum, a new event
  kind. Anything else is breaking and raises the major version: removing or renaming a field,
  making one required, changing its type or meaning, or a new value of a closed enum.
- 1.0.0 is a clean break from 0.x (see the table). The report UI still opens any 0.x report,
  and one with no `schemaVersion`: it upgrades it to 1.0.0's shape when it reads it.
- To change the format: edit the schema, raise the version in both `$id`s and in
  `ReportSchema.VERSION` (lsd-mono-report-model), and regenerate the UI's types (below).

| Version | Change |
|---------|--------|
| `0.1.0` | The format as lsd-mono-jvm 0.7 wrote it. |
| `0.2.0` | A message's optional `attributes` and `origin`; `Trace` frozen at three ids and its id forms written down. Only adds: a 0.1 report is a valid 0.2 report. |
| `0.3.0` | A participant's optional `attributes`, with the same keys and values as a message's. Only adds: a 0.2 report is a valid 0.3 report. |
| `1.0.0` | The format frozen, with the compatibility rule promised from here on. Breaking from 0.x: enum values are lower snake case; scenario statuses `skipped` and `aborted`; `generator` is `{name, version?}`; `alias`→`displayName`, `colour`→`color`, `labelMaxWidth`→`labelMaxChars`, `measuredCoverage`→`measuredRatio`, `pairingCoverage`→`pairedRatio`, `clockOrdered`→`clockOrderedCount`, an index scenario's `messages`→`messageCount`; a reply's `replyTo` is its call's message id (`replyOf` is gone, the call id is `callId`); optional fields are never written empty; the index `title` and `options.usagePing` are optional. The report UI upgrades a 0.x report or index when it reads it. |

### The compatibility rule

**Readers ignore fields they do not know, and a minor version only adds optional fields** (and
values of open enums and event kinds), as it did in 0.x. A field is never made required,
renamed, removed or given a new type or meaning in a minor version; that takes a new major. The
rule is the same as OpenTelemetry's own for OTLP ("receivers MUST ignore message fields with
unknown names"), and the shared test reports prove it: `reports/future-minor.json` (schema
`1.1.0`, with fields, enum values and an event kind this version does not know) is accepted by
both validators and opened by the report UI.

### What a reader does

A reader of one version can take a report of a newer minor version, and the schema of one
version still validates it:

- **Unknown fields:** objects accept properties they do not list; a reader ignores them.
- **Open enums** accept any string as well as the values they list, and a reader falls back for
  a value it does not know: participant type (drawn as `participant`), message type (a
  `synchronous` arrow), timing, pairing and order sources, timing warning kinds, and the report
  `source`. Each one's description says what its fallback is.
- **Closed enums** are the ones whose meaning a reader cannot guess: `status`, note
  `placement`, `accuracy`, `clockOrdering`, and the `activate`/`deactivate` kind.
- **Unknown event kinds:** an event whose `kind` is none of the known ones is an
  `UnknownEvent`, and a reader drops it. A known kind still has to have its fields.
- **Optional for any producer:** the report's `options` (each field defaults as its description
  says) and a scenario's timing summary (`accuracy`, `sources`, `clockOrdering`,
  `clockOrderedCount`). A producer with no timing analysis leaves them out; lsd-mono-jvm always
  writes them.
- **A newer major version** may break any of this, so a reader says it cannot show the report
  rather than guess.

The report UI (`src/lib/schema-version.ts`) shows a report or index of a newer minor version
with a small notice that anything new in it is not shown. For a newer major version it shows a
page saying to upgrade lsd-mono instead of the report (on the index page, instead of that one
report), and for a `schemaVersion` that is not a major.minor.patch version a page saying it cannot
be opened. A report or index with no `schemaVersion`, or a 0.x one, is from before 1.0.0: the UI
upgrades it on read (`upgradeLegacyReport` in `src/lib/report-normalise.ts`, `normaliseIndex` in
`src/lib/report-index.ts`) and shows it as usual.

## OpenTelemetry

Decided before 1.0.0, and kept in it: the format stays LSD's own event model (calls and replies as
separate arrows, notes, sections, dividers), not OpenTelemetry spans, and nothing here depends on
OpenTelemetry. Importing spans (OTLP files, Jaeger or Tempo) is to be an optional module, added
in a 1.x minor version
([#96](https://github.com/lsd-consulting/lsd-mono/issues/96)). So that it can be added without a
breaking change, 0.2.0 settles the parts OpenTelemetry touches:

- **`trace` is frozen** at `traceId`, `spanId` and `parentSpanId`; no minor version adds to it.
  W3C Trace Context and OpenTelemetry ids are lowercase hex (32 characters for the trace, 16 for a
  span), and producers should write them so. B3 ids, a 16-character trace id among them, are
  accepted too: no id format is enforced. Anything else about a span (flags, trace state, kind,
  status) is an attribute.
- **`attributes`**, optional on a message: named values (a string, boolean or number, or a list of
  one of those, as OpenTelemetry's are). Keys use OpenTelemetry's semantic convention names where
  there is one (`http.request.method`, `http.route`, `http.response.status_code`, `url.full`,
  `messaging.destination.name`, `rpc.method`, `service.name`); keys starting `lsd.` are kept for
  lsd-mono's own. No attribute changes how a message is drawn.
- **`attributes`**, optional on a participant too (0.3.0), with the same values and key rules:
  `service.name`, `service.version` and `service.namespace` for the service a participant is,
  `peer.service` for a remote one it stands for. No attribute changes how a participant is drawn.
- **`origin`**, optional on a message, an open enum: `captured` (recorded by the producer while the
  test ran) or `imported` (built afterwards from another record, such as spans). Absent means
  captured, so lsd-mono-jvm writes none. It is not `source`, which is the clock domain.
- **Times stay as they are:** `startedAt` (RFC 3339, which can carry nanoseconds) and `durationMs`
  (to the microsecond). An import loses precision below a microsecond, which a diagram does not
  need.

lsd-mono-jvm writes neither `attributes` (on a message or a participant) nor `origin` yet, and the report UI does not show them
yet: they are for producers that import, and for the import module. Span links, should they come,
would be an optional `links` list on a message, not part of `trace`.

## Who uses it

- **lsd-mono-jvm** writes `schemaVersion` and validates real output against both schemas in
  `ReportSchemaTest` (networknt json-schema-validator, test scope only, formats asserted). The
  test also checks that each enum lists exactly the writer's values, and that the writer writes
  only known values: its output follows a copy of the schema with every open enum closed to its
  `Known*` list, so a typo such as `QUEU` fails there though the schema itself takes it.
- **The Kotlin tests** read the schemas and the shared test reports from the classpath:
  lsd-mono-report-model's test fixtures (`ReportSchemas`, `ReportCorpus`) put this directory on
  it as `/lsd-mono-report-schema`. A test that validates with them (core's, the integration
  modules', the writer's) reruns when a schema or a corpus file changes, cache or not.
- **The report UI** (`modules/lsd-mono-report-html/ui`) generates its TypeScript types from the
  schemas into `src/generated/` with `npm run types:generate` (json-schema-to-typescript). The
  generated files are committed, and `npm run types:check`, on Gradle's `check` through
  `reportLint`, fails when they differ from what the schemas give, so they are never edited by
  hand. An open enum's `tsType` gives the TypeScript type its known values plus any other
  string (`KnownMessageType | (string & {})`), and `DiagramEvent`'s `tsType` leaves out
  `UnknownEvent`, which the UI drops when it loads a report. `src/lib/report-schema.test.ts`
  validates the golden files, the checks' example reports and the tests' shared report builders
  with ajv, formats included (ajv-formats).

## The shape, and the rules it keeps

- **Flat timing summary.** A scenario's `accuracy`, `measuredRatio`, `pairedRatio`,
  `sources`, `wallClockMs`, `clockOrdering`, `clockOrderedCount`, `warnings`, `reorderedByClock` and
  `pairAccuracy` sit on the scenario itself, not in a `timing` object. A message's `timing` is
  something else: where its duration came from.
- **One rule for empties.** An optional field is left out rather than written empty: no empty
  string, list or object. A reader treats absent as empty. Required fields are never empty.
- **`displayName`** is the name drawn instead of a participant's `name`; `color` its colour.
- **Diagram edges are absent.** A `short_inbound` message has no `from` and a `short_outbound`
  message no `to`; the same goes for `pairAccuracy` pairs.
- **One case.** Every enum value is lower snake case (`success`, `right_of`, `database`,
  `synchronous_response`, `structure_only`).
- **Scenario status.** `success`, `warn`, `error`, `skipped` (did not run: a disabled JUnit test, a
  skipped Cucumber scenario) and `aborted` (stopped part way, such as a failed JUnit assumption).
  `warn` is left for a pending, undefined or ambiguous step, or a scenario still running. A
  report's or index entry's status is its worst scenario's, ranked
  error > warn > aborted > success > skipped.
- **Replies.** A reply's `replyTo` is the `id` of the message it answers; `callId` is the call id
  the producer paired them by, when it had one.
- **Message status as text.** A message's `status` (an HTTP status, say) is a string even when it
  is a number, and absent when there is none.
- **Two copies of a report.** `<stem>-report.json` keeps each message's whole `data`. The copy
  in the diagram page and `<stem>-report.js` moves a payload with more than its method, path and
  status to `<stem>-payloads.js`: its `data` keeps only those (or goes), and `payloadId` names it.
  `payloadId` is only ever in the page's copy, never in `<stem>-report.json`.
- **Reproducible reports** (`lsd.mono.report.generatedAt` or deterministic ids) leave out each
  message's `capturedAt`; `seq` is absent when a message was not counted.
- **Times** are RFC 3339 date-times (`format: date-time`, asserted by both validators), so
  another producer may write an offset. lsd-mono-jvm writes UTC instants ending in `Z`, to the
  millisecond or finer (`generatedAt` is cut to milliseconds, and printed without them when
  they are zero).
- **The index** `title` is optional (the page shows `LSD reports` without one), as is
  `options.usagePing` (default `false`). Each scenario has a `messageCount`. Each entry's `data` (its `<stem>-report.js`) is
  optional and, without a stem, its `id` is its page's file name; lsd-mono-jvm writes both today.
- **Non-map payloads.** A message's `data` can be any JSON value: a map, a string or a list.
- **`generator`** is `{ "name": "lsd-mono-jvm", "version": "1.0.0" }`, `version` optional. The
  page shows the name as "Written by …", with the version only when it is not the page's own; its
  version chip and the usage ping use the page's own lsd-mono-report-html version.

The report UI also reads 0.x reports and reports from before the schema (an older lsd-mono's
`<stem>-report.js` in the same directory as a newer index). It upgrades them to 1.0.0's shape
(case, names, generator, replies) and fills in the optional fields in one place when it loads a
report (`src/lib/report-normalise.ts`); `conformance/invalid/legacy-*.json` are its test files.

## Shared test reports

[`conformance/`](conformance/README.md) holds report data both lsd-mono-jvm and the report UI
are tested against: reports the schema must accept, reports it must reject, an index manifest and
a generated large report.
