# lsd-mono-report-html

Part of [LSD: living sequence diagrams](../../README.md). An internal building block: most users depend on [`lsd-mono-jvm`](../lsd-mono-jvm/README.md) or a framework module instead.

Writes an LSD report: the model ([lsd-mono-report-model](../lsd-mono-report-model)) as
`<stem>-report.json`, the interactive report page `<stem>-diagram.html`, `<stem>-report.js` for
the index page, `<stem>-payloads.js` with the message bodies, and `index.html`, which lists every
report in the directory. The page is the single-file report shell, built from this repository's
report UI at the same commit and bundled in the jar (`/lsd-mono-report-html/lsd-report.single.html`),
so a JVM build never needs Node.

lsd-mono-jvm writes its reports with it. A producer without lsd-mono-jvm (an adapter for
another test framework, or a trace importer) builds a `ReportJson` and writes it the same way:

```kotlin
val writer = ReportWriter(ReportWriterSettings(generator = "my-adapter 1.0"))
writer.writeReport(report, Path.of("build/reports/lsd"))
writer.writeIndex(Path.of("build/reports/lsd"))
```

`AdapterReportTest` (in `src/test/kotlin/io/github/lsdconsulting/lsd/mono/example/adapter`) does this with
this module and lsd-mono-report-model only, no lsd-mono-jvm: its minimal report is the shared test
report `reports/minimal.json` byte for byte, and what it writes follows the report and index schemas.

| | |
| --- | --- |
| **Is** | `ReportWriter`, its `ReportWriterSettings` and `ReportFiles` (also what lsd-mono-jvm's `completeReport` returns), in `io.github.lsdconsulting.lsd.mono.report.html` |
| **Is not** | Capture, timing or properties: the caller passes everything the files need |

## Compatibility

`ReportWriter`, `ReportWriterSettings` and `ReportFiles` are no longer experimental, and neither is
the model they take ([lsd-mono-report-model](../lsd-mono-report-model#compatibility)): no opt-in is
needed: remove any `@OptIn(ExperimentalLsdReportModel::class)`, as the annotation is gone. lsd-mono-jvm's own API does not expose either module.

The writer reads no properties. `ReportWriterSettings` gives what the index page says beyond the
reports: the generator, the time (the time of writing when it is null) and whether the page may send
the usage ping. Several writers, in one JVM or in several, can share an output directory: every file
is written to a temporary file and moved into place, and the index lists every report written there.
Every text in the files is escaped for where it goes (HTML text, attribute or script), so no report
text can close the page's script element.
