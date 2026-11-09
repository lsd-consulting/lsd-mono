# Moving from the earlier LSD reports

This guide is for people moving from the earlier PlantUML-based LSD reports to lsd-mono. It is the
one place that explains the move. The earlier libraries are not part of this tree, and lsd-mono does
not render diagrams with PlantUML: the report app draws them as its own SVG.

## Dependencies

Every published artifact is `io.github.lsd-consulting:<artifact>` and they share one version. The
ones that replace the earlier libraries are:

| Earlier library | Use now |
| --- | --- |
| `lsd-core` | `lsd-mono-jvm` (this was briefly published as `lsd-mono-core`; see [Moving from lsd-mono-core](../README.md#moving-from-lsd-mono-core)) |
| `lsd-junit5` / `lsd-junit-jupiter` | `lsd-mono-junit-jupiter` (JUnit Jupiter 6) |
| The earlier Cucumber plugin | `lsd-mono-cucumber-8` |
| Coroutine support | `lsd-mono-coroutines` |

There are also starters that capture from tests with little or no extra code: `lsd-mono-spring-boot-4`,
`lsd-mono-http4k-6` and `lsd-mono-ktor-3`. [Which artifact to depend on](../modules/README.md#which-artifact-to-depend-on)
has the full map.

<!-- release-version:start (the release workflow updates the versions up to the end marker) -->

The snippets below match the root README and show 0.16.0. They run on Java 17 or later
(`lsd-mono-http4k-6` needs Java 21, as http4k 6 does).

Gradle (Kotlin DSL):

```kotlin
dependencies {
    testImplementation("io.github.lsd-consulting:lsd-mono-spring-boot-4:0.16.0")
}
```

Maven:

```xml
<dependency>
    <groupId>io.github.lsd-consulting</groupId>
    <artifactId>lsd-mono-spring-boot-4</artifactId>
    <version>0.16.0</version>
    <scope>test</scope>
</dependency>
```

<!-- release-version:end -->

For JUnit without a starter, add `lsd-mono-junit-jupiter` and `@ExtendWith(LsdExtension::class)`. For
Cucumber 8, add `lsd-mono-cucumber-8` and
`cucumber.plugin=io.github.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin`. The root
[README](../README.md#supported-stacks-today) has a row for each stack.

Packages live under `io.github.lsdconsulting.lsd.mono.*`, matching the `io.github.lsd-consulting`
group. The capture API is in the [lsd-mono-jvm README](../modules/lsd-mono-jvm/README.md) and the
[JVM API guide](jvm-api.md).

## PlantUML is gone

The report app draws the sequence and component diagrams as its own SVG. There is no PlantUML
binary, no `.puml` source, and no generated image to attach. What you open is the interactive HTML
page below.

## Output files

Each report writes:

- `<name>-<id>-report.json`, the data
- `<name>-<id>-report.js` and `<name>-<id>-payloads.js`, loaded on demand
- `<name>-<id>-diagram.html`, the interactive page for that report

The 8-character id is a hash of the report key (or the title if there is no key), so two
reports never share a file. `completeReport` returns the paths as `ReportFiles` (`diagramHtml`,
`reportJson`).

`createIndex()` writes one `index.html` per output directory. It is the report app for every report
there: a sidebar lists the reports (failed first), a report's data loads only when it is opened, and
`#report=` / `#scenario=` / `#msg=` links open a report, scenario or message directly.

Pages are self-contained and work offline: the fonts are embedded, and the only network request is
the [usage ping](usage-ping.md). Open `build/reports/lsd/index.html` after a test run (or set
`lsd.mono.report.outputDir` to write somewhere else).

The on-disk JSON follows [report schema 1.0.0](../modules/lsd-mono-report-schema/README.md). Older
0.x reports still open.

## The report UI

The report shows one scenario at a time, chosen from the sidebar. Each scenario has:

- a sequence diagram whose header shapes come from the captured participant types (actor, database,
  queue, entity, boundary, and participant (the default box; the header calls it a component));
- zoom, fit, an overview of the whole width, in-diagram find, and hiding participants;
- a **Sequence | Components** switch for the scenario's component diagram;
- a side panel for an arrow's JSON (payloads load when the panel opens; secret-looking keys are
  redacted when captured), a component link's messages, and timing and metrics;
- Metrics (message count and captured duration) on by default, switched off with
  `lsd.mono.metrics.enabled=false`.

The [report UI guide](report.md) has the details, and the root README has a [tour](../README.md).

## Timing

When a scenario has timing, the Timing view shows a summary strip (wall-clock, calls, slowest call,
accuracy), swim lanes and a waterfall. Slow calls show there.

The timing API records explicit durations, `startedAt`, and call pairing (`parentId`). Events can
also be ordered by clock (`lsd.mono.timing.orderByStartedAt`). The earlier ranked bottleneck list
was not carried over: the waterfall is where slow calls appear.

See [Timing](jvm-api.md#timing) in the JVM API guide.

## Themes

Dark, light and high contrast. With no saved `lsd-report-theme-v2` in local storage, the page follows
the operating system. The theme menu in the top bar chooses one, and `d` steps through them.

## Usage ping

A report page from a published (non-snapshot) release sends one tiny anonymous jsDelivr request per
event, naming only the version and the event. No report data is sent, and the page works the same
offline. Switch it off with `lsd.mono.report.usagePing=false`. [Usage ping](usage-ping.md) lists the
events.

## Configuration

Every setting is a `lsd.mono.*` property. `LsdProperties` has a constant for each name. They can be
set as:

1. a system property: `-Dlsd.mono.report.outputDir=out`;
2. an environment variable, in upper case with dots as underscores: `LSD_MONO_REPORT_OUTPUTDIR=out`;
3. a JUnit configuration parameter (with `lsd-mono-junit-jupiter`), for example in
   `src/test/resources/junit-platform.properties`;
4. `lsd-mono.properties` at the root of the classpath.

The [configuration reference](jvm-api.md#configuration-reference) lists every key and its default.

The earlier names are not read. If you still set them, rename:

| Earlier name | Use now |
| --- | --- |
| `lsd.core.report.outputDir` | `lsd.mono.report.outputDir` |
| `lsd.core.ids.deterministic` | `lsd.mono.ids.deterministic` |
| `lsd.junit.hideStacktrace` | `lsd.mono.hideStacktrace` |
| `lsd.core.metrics.enabled` | `lsd.mono.metrics.enabled` |
| `lsd.core.label.maxWidth` | `lsd.mono.label.maxWidth` |

Those five were the only earlier names lsd-mono ever accepted, and they are no longer fallbacks.
Other `lsd.core.*` / `lsd.junit.*` keys were never mapped.

## What changed for readers of the old reports

These are the breaks we know about, checked against the current capture API and report files, not
guessed:

- There is no PlantUML render and no `.puml` source in the output. The report is the HTML page and
  its JSON / JS data files, described above.
- The configuration keys above must use the `lsd.mono.*` names.
- The core artifact is `lsd-mono-jvm`, not `lsd-core` or `lsd-mono-core`, and the packages are
  `io.github.lsdconsulting.lsd.mono.*`.
- The report JSON is schema 1.0.0. Older 0.x reports still open in the app.
- The earlier ranked bottleneck list is not in the report; slow calls appear in the Timing view.

The capture API you call from tests and from your own code is the one in
[lsd-mono-jvm](../modules/lsd-mono-jvm/README.md) and the [JVM API guide](jvm-api.md). This guide
does not invent further mappings from the earlier API.
