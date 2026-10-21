# lsd-mono-report-html

Writes an LSD report: the model ([lsd-mono-report-model](../lsd-mono-report-model)) as
`<stem>-report.json`, the interactive report page `<stem>-diagram.html`, `<stem>-report.js` for
the index page, `<stem>-payloads.js` with the message bodies, and `index.html`, which lists every
report in the directory. The page is the single-file report shell, built from this repository's
report UI at the same commit and bundled in the jar (`/lsd-mono-report-html/lsd-report.single.html`),
so a JVM build never needs Node.

lsd-mono-core writes its reports with it. A producer without lsd-mono-core (an adapter for
another test framework, or a trace importer) builds a `ReportJson` and writes it the same way:

```kotlin
val writer = ReportWriter(ReportWriterSettings(generator = "my-adapter 1.0"))
writer.writeReport(report, File("build/reports/lsd"))
writer.writeIndex(File("build/reports/lsd"))
```

| | |
| --- | --- |
| **Is** | `ReportWriter`, its `ReportWriterSettings` and `WrittenReport`, in `io.lsdconsulting.lsd.mono.report.html` |
| **Is not** | Capture, timing or properties: the caller passes everything the files need |

## Experimental: no binary-compatibility promise yet

`ReportWriter`, `ReportWriterSettings` and `WrittenReport` are marked `@ExperimentalLsdReportModel`,
as every type of the model they take is ([lsd-mono-report-model](../lsd-mono-report-model)): a
`RequiresOptIn` marker at level ERROR. A Kotlin caller opts in with
`@OptIn(ExperimentalLsdReportModel::class)` or
`-opt-in=io.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel`.

There is no binary-compatibility promise until the marker goes. **Java callers don't see opt-in
markers**, so for Java this note is the only warning. The model's shape will change before 1.0, once
the OpenTelemetry alignment is decided, and the writer's signatures change with it
([#118](https://github.com/lsd-consulting/lsd-mono/issues/118)). lsd-mono-core's own API does not
expose either module, so a test that uses lsd-mono-core, its JUnit or Cucumber integration is not
affected.

The writer reads no properties. `ReportWriterSettings` gives what the index page says beyond the
reports: the generator, the time (the time of writing when it is null) and whether the page may send
the usage ping. Several writers, in one JVM or in several, can share an output directory: every file
is written to a temporary file and moved into place, and the index lists every report written there.
Every text in the files is escaped for where it goes (HTML text, attribute or script), so no report
text can close the page's script element.
