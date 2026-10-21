# lsd-mono-report-model

The LSD report as plain Kotlin values: `ReportJson`, its scenarios, participants and events, as
the report schema ([`modules/lsd-mono-report-schema`](../lsd-mono-report-schema)) describes them,
plus the schema version a report follows (`ReportSchema.VERSION`).

It has no dependencies beyond the Kotlin standard library and no behaviour: it is the shape that
lsd-mono-core builds and lsd-mono-report-html writes. A producer that does not use lsd-mono-core
(an adapter for another test framework or a trace importer) builds a `ReportJson` from these
classes and writes it with lsd-mono-report-html.

| | |
| --- | --- |
| **Is** | The report's data classes, in `io.lsdconsulting.lsd.mono.report.model` |
| **Is not** | JSON text, files or the page: lsd-mono-report-html writes those |

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
`Any?` and should hold JSON values (null, strings, booleans, numbers, maps and lists); nothing checks
it, and the writer writes anything else as its `toString()`.
## Experimental: no binary-compatibility promise yet

Every type here is marked `@ExperimentalLsdReportModel`, a `RequiresOptIn` marker at level ERROR
(like lsd-mono-core's `@InternalLsdApi`). A Kotlin caller opts in with
`@OptIn(ExperimentalLsdReportModel::class)`, or once per module with
`-opt-in=io.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel`.

There is no binary-compatibility promise until the marker goes:

- The classes are data classes, and the schema's minor versions add fields. Each added field changes
  a class's constructor, `copy` and `componentN` functions, so code compiled against one release can
  fail with `NoSuchMethodError` against the next.
- **Java callers don't see opt-in markers.** Java compiles against these classes with no warning, so
  this note is the only one a Java caller gets.
- The shape will change before 1.0, once the OpenTelemetry alignment is decided: the wide classes
  are to become plain classes with a builder, and the small fixed values stay data classes
  ([#118](https://github.com/lsd-consulting/lsd-mono/issues/118)).

The ABI dump (`api/lsd-mono-report-model.api`) is kept, so that every change shows in review.

Its test fixtures, for this repository's tests and not published, put the report schemas and the
shared test reports on the classpath: `ReportSchemas` validates written output against the schemas
and `ReportCorpus` reads the test reports in `modules/lsd-mono-report-schema/conformance`.
