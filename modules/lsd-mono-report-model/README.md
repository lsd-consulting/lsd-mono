# lsd-mono-report-model

Part of [LSD: living sequence diagrams](../../README.md). An internal building block: most users depend on [`lsd-mono-jvm`](../lsd-mono-jvm/README.md) or a framework module instead.

The LSD report as plain Kotlin values: `ReportJson`, its scenarios, participants and events, as
the report schema ([`modules/lsd-mono-report-schema`](../lsd-mono-report-schema)) describes them,
plus the schema version a report follows (`ReportSchema.VERSION`).

It has no dependencies beyond the Kotlin standard library and no behaviour: it is the shape that
lsd-mono-jvm builds and lsd-mono-report-html writes. A producer that does not use lsd-mono-jvm
(an adapter for another test framework or a trace importer) builds a `ReportJson` from these
classes and writes it with lsd-mono-report-html.

| | |
| --- | --- |
| **Is** | The report's values and their builders, in `io.github.lsdconsulting.lsd.mono.report.model` |
| **Is not** | JSON text, files or the page: lsd-mono-report-html writes those |

The values that grow with the schema (`ReportJson`, `ReportOptionsJson`, `ScenarioJson`,
`ScenarioErrorJson`, `ParticipantJson` and every event class) are plain classes made with a
builder: `builder(…)` takes what the schema requires, each optional field has a setter, and
`toBuilder()` makes a changed copy. A newer release adds setters, which breaks no caller, Kotlin or
Java. The small fixed values (`FactJson`, `MetricJson`, `TraceJson`, `WarningJson`,
`PairAccuracyJson`) are data classes; `AttributeValueJson` and `DataValueJson` are made with `of(…)`.

```kotlin
val report =
    ReportJson
        .builder(title = "Checkout", generatedAt = "2026-10-21T08:00:00Z", generator = "my-adapter 1.0", status = StatusJson.SUCCESS)
        .scenario(
            ScenarioJson
                .builder(id = "pay", title = "Pay", status = StatusJson.SUCCESS)
                .participant(ParticipantJson.builder("shop", "Shop").type(KnownParticipantType.ACTOR).build())
                .participant(ParticipantJson.builder("payments", "Payments").build())
                .event(
                    MessageEventJson
                        .builder("m1", "shop", "payments", "POST /payments", KnownMessageType.SYNCHRONOUS)
                        .durationMs(12.5)
                        .attribute("http.route", "/payments")
                        .build(),
                ).build(),
        ).build()
```

Java uses the same calls (`ReportJson.builder(…)…build()`).

The model follows the schema's shape: the scenario's timing summary (`accuracy`, `sources`,
`clockOrdering` and the rest) is flat on `ScenarioJson`, as in the schema. Enum-like values follow
one rule:

- **Closed in the schema** (`Status`, `NotePlacement`, `Accuracy`, `ClockOrdering`, a lifeline
  event's kind): a Kotlin enum (`StatusJson`, `NotePlacementJson`, `AccuracyJson`,
  `ClockOrderingJson`, `LifelineKindJson`), whose `json` is the value written.
- **Open in the schema** (participant and message types, timing, pairing and order sources, warning
  kinds, the report source): a `String`, so a newer schema's values fit, with the known values as
  constants (`KnownParticipantType`, `KnownMessageType`, … `KnownReportSource`).

The model's tests hold both to the schema's lists. The event classes are sealed to the kinds
lsd-mono writes. The schema's events are open, so code that reads a report it did not write must
tolerate an unknown event kind rather than assume this list is complete. A message's `data` is
a `DataValueJson`: a JSON value made with `DataValueJson.of(…)` (a String, Boolean, Long, Int,
finite Double, BigInteger or BigDecimal), `ofList`, `ofObject` or `DataValueJson.NULL`.
`DataValueJson.from(…)` converts plain values (maps, lists, arrays, numbers and so on) the way the
writer converted `Any?` data before 0.10: a non-finite number or any other object becomes its
`toString()`, and a cycle becomes `"[lsd: cycle]"`. A null `data` is not written; `NULL` is written
as `null`.

A message's and a participant's `attributes` are typed: each value is an `AttributeValueJson`, made with
`AttributeValueJson.of(…)` (a String, Boolean, Long, Int or finite Double) or `ofStrings`,
`ofBooleans`, `ofLongs` or `ofDoubles` for a list, as OpenTelemetry's attribute values are. Keys
are not empty; OpenTelemetry's semantic names (`service.name`, `peer.service`, …) are used where one
fits, and `lsd.*` is lsd's own. A message's
`origin` is `KnownMessageOrigin.IMPORTED` for a message built from another record, such as spans,
and null for one the producer captured.

## Experimental: no binary-compatibility promise yet

Every type here is marked `@ExperimentalLsdReportModel`, a `RequiresOptIn` marker at level ERROR
(like lsd-mono-jvm's `@InternalLsdApi`). A Kotlin caller opts in with
`@OptIn(ExperimentalLsdReportModel::class)`, or once per module with
`-opt-in=io.github.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel`.

There is no binary-compatibility promise until the marker goes:

- The builders ([#118](https://github.com/lsd-consulting/lsd-mono/issues/118)) are the shape meant
  for 1.0: adding a field adds a setter, and changes no constructor, `copy` or `componentN` function
  a caller compiled against. The marker stays until that shape has been used for a release or two.
- **Java callers don't see opt-in markers.** Java compiles against these classes with no warning, so
  this note is the only one a Java caller gets.
- The trace and timing fields are settled: `TraceJson` is frozen at its three ids, and
  OpenTelemetry's other span data arrives as a message's `attributes` (see the schema's
  [OpenTelemetry](../lsd-mono-report-schema/README.md#opentelemetry)). A message's `data` is a
  `DataValueJson` (it was `Any?` before 0.10).

The ABI dump (`api/lsd-mono-report-model.api`) is kept, so that every change shows in review.

Its test fixtures, for this repository's tests and not published, put the report schemas and the
shared test reports on the classpath: `ReportSchemas` validates written output against the schemas
and `ReportCorpus` reads the test reports in `modules/lsd-mono-report-schema/conformance`.
