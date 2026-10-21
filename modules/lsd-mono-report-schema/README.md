# lsd-mono-report-schema

JSON Schemas (2020-12) for the report data lsd-mono writes, so the format is owned by neither the
Kotlin writer nor the TypeScript report UI:

| File | Describes | Written as |
|------|-----------|------------|
| `lsd-report.schema.json` | One report | `<stem>-report.json`; `window.__LSD_REPORT__` in `<stem>-diagram.html`; the `report` in `<stem>-report.js` |
| `lsd-index.schema.json` | The index manifest | `window.__LSD_INDEX__` in `index.html` |

This is a plain directory, not a Gradle project or a published artifact (yet).

## Versions

**Pre-1.0: the schema may change before 1.0.0.** How the format lines up with OpenTelemetry is
still open, so it stays 0.x until that is decided.

- Every report and index has a required `schemaVersion`: the semver of the schema it follows,
  apart from the lsd-mono version. This is `0.1.0`.
- The version is in each schema's `$id`
  (`https://lsd-consulting.github.io/lsd-mono/schema/0.1.0/lsd-report.schema.json`). Nothing is
  published at that address yet; the `$id`s name the schemas and let the index schema refer to
  the report schema.
- **A minor version only adds**, 0.x included: a new optional field, a new value of an open
  enum, a new event kind. Anything else is breaking and raises the major version, even before
  1.0: removing or renaming a field, making one required, changing its type or meaning, or a new
  value of a closed enum. (This is stricter than semver's "anything goes" for 0.x, so a reader
  can trust a minor version.)
- To change the format: edit the schema, raise the version in both `$id`s and in
  `ReportSchema.VERSION` (lsd-mono-core), and regenerate the UI's types (below).

### What a reader does

A reader of one version can take a report of a newer minor version, and the schema of one
version still validates it:

- **Unknown fields:** objects accept properties they do not list; a reader ignores them.
- **Open enums** accept any string as well as the values they list, and a reader falls back for
  a value it does not know: participant type (drawn as `PARTICIPANT`), message type (a
  `SYNCHRONOUS` arrow), timing, pairing and order sources, timing warning kinds, and the report
  `source`. Each one's description says what its fallback is.
- **Closed enums** are the ones whose meaning a reader cannot guess: `status`, note
  `placement`, `accuracy`, `clockOrdering`, and the `activate`/`deactivate` kind.
- **Unknown event kinds:** an event whose `kind` is none of the known ones is an
  `UnknownEvent`, and a reader drops it. A known kind still has to have its fields.
- **Optional for any producer:** the report's `options` (each field defaults as its description
  says) and a scenario's timing summary (`accuracy`, `sources`, `clockOrdering`,
  `clockOrdered`). A producer with no timing analysis leaves them out; lsd-mono-core always
  writes them.
- **A newer major version** may break any of this, so a reader says it cannot show the report
  rather than guess.

The report UI (`src/lib/schema-version.ts`) shows a report or index of a newer minor version
with a small notice that anything new in it is not shown. For a newer major version it shows a
page saying to upgrade lsd-mono instead of the report (on the index page, instead of that one
report), and for a `schemaVersion` that is not a major.minor.patch version a page saying it cannot
be opened. A report without `schemaVersion` is from before the schema and is shown as usual.

## Who uses it

- **lsd-mono-core** writes `schemaVersion` and validates real output against both schemas in
  `ReportSchemaTest` (networknt json-schema-validator, test scope only, formats asserted). The
  test also checks that each enum lists exactly the writer's values.
- **The report UI** (`modules/lsd-mono-core/report`) generates its TypeScript types from the
  schemas into `src/generated/` with `npm run types:generate` (json-schema-to-typescript). The
  generated files are committed, and `npm run types:check`, on Gradle's `check` through
  `reportLint`, fails when they differ from what the schemas give, so they are never edited by
  hand. An open enum's `tsType` gives the TypeScript type its known values plus any other
  string (`KnownMessageType | (string & {})`), and `DiagramEvent`'s `tsType` leaves out
  `UnknownEvent`, which the UI drops when it loads a report. `src/lib/report-schema.test.ts`
  validates the golden files, the checks' example reports and the tests' shared report builders
  with ajv, formats included (ajv-formats).

## Today's shape, quirks included

The schemas describe the format as lsd-mono-core 0.7 writes it, not a redesign. Some things a
fresh design would do differently:

- **Flat timing summary.** A scenario's `accuracy`, `measuredCoverage`, `pairingCoverage`,
  `sources`, `wallClockMs`, `clockOrdering`, `clockOrdered`, `warnings`, `reorderedByClock` and
  `pairAccuracy` sit on the scenario itself, not in a `timing` object. A message's `timing` is
  something else: where its duration came from.
- **Empty lists left out.** `warnings`, `reorderedByClock` and `pairAccuracy` are absent rather
  than empty; `facts`, `metrics`, `participants` and `events` are always present, even empty.
- **`alias` is the display name.** A participant's `alias` is what the Kotlin API calls
  `displayName`: the name drawn instead of `name`.
- **Diagram edges are empty strings.** A `SHORT_INBOUND` message's `from` and a `SHORT_OUTBOUND`
  message's `to` are `""`, not absent; the same goes for `pairAccuracy` pairs.
- **Mixed case.** Statuses and note placements are lower case (`success`, `over`); participant
  types, message types and the timing enums are upper case (`DATABASE`, `SYNCHRONOUS`,
  `STRUCTURE_ONLY`).
- **Status as text.** A message's `status` (an HTTP status, say) is a string even when it is a
  number.
- **Two copies of a report.** `<stem>-report.json` keeps each message's whole `data`. The copy
  in the diagram page and `<stem>-report.js` moves a payload with more than its method, path and
  status to `<stem>-payloads.js`: its `data` keeps only those (or goes), and `payloadId` names it.
- **Reproducible reports** (`lsd.mono.report.generatedAt` or deterministic ids) leave out each
  message's `capturedAt`; `seq` is absent when a message was not counted.
- **Times** are RFC 3339 date-times (`format: date-time`, asserted by both validators), so
  another producer may write an offset. lsd-mono-core writes UTC instants ending in `Z`, to the
  millisecond or finer (`generatedAt` is cut to milliseconds, and printed without them when
  they are zero).
- **The index** is always titled `LSD reports`. Each entry's `data` (its `<stem>-report.js`) is
  optional and, without a stem, its `id` is its page's file name; lsd-mono-core writes both today.
- **Non-map payloads.** A message's `data` can be any JSON value: a map, a string or a list.
- **`generator`** stays free text such as `lsd-mono-core 0.7.0`: the usage ping matches it.

The report UI also reads reports from before the schema (an older lsd-mono's `<stem>-report.js`
in the same directory as a newer index), which can lack fields the schema requires. It fills in
the optional fields and the older ones' defaults in one place when it loads a report
(`src/lib/report-normalise.ts`).

## Shared test reports

[`conformance/`](conformance/README.md) holds report data both lsd-mono-core and the report UI
are tested against: reports the schema must accept, reports it must reject, an index manifest and
a generated large report.
