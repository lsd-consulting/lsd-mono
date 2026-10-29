# lsd-mono-jvm

Part of [LSD: living sequence diagrams](../../README.md).

`lsd-mono-jvm` is the core of LSD. Use its `LsdContext` API from a test, from application code, or by hand to draw how your services talk, and write an interactive HTML report. It needs no test framework: draw a flow from a sample app, a batch job or a tool, or describe one by hand ([Capture a scenario by hand](#capture-a-scenario-by-hand)). The JUnit, Cucumber and coroutines integrations and the framework modules build on it.

## Depend on it

<!-- release-version:start (the release workflow updates the versions up to the end marker) -->

[![Maven Central: lsd-mono-jvm](https://img.shields.io/maven-central/v/io.github.lsd-consulting/lsd-mono-jvm?label=lsd-mono-jvm)](https://central.sonatype.com/artifact/io.github.lsd-consulting/lsd-mono-jvm)

```kotlin
testImplementation("io.github.lsd-consulting:lsd-mono-jvm:0.15.0")
```

<!-- release-version:end -->

Use `implementation(...)` instead of `testImplementation(...)` to draw diagrams from application code rather than from tests.

## Layout

It maps what it captured to the report model ([lsd-mono-report-model](../lsd-mono-report-model)) and writes the
report JSON and the interactive HTML report with [lsd-mono-report-html](../lsd-mono-report-html),
which it depends on. The report UI lives in lsd-mono-report-html's `ui/` (TypeScript and a
custom SVG diagram).

```text
lsd-mono-jvm/
├── src/main/kotlin/…/mono/jvm/  # Kotlin façade (capture, timing, mapping to the report model)
└── build.gradle.kts             # depends on lsd-mono-report-model and lsd-mono-report-html
lsd-mono-report-html/
├── ui/                          # Vite+TS report UI (dev with npm)
│   ├── src/                     # UI, custom SVG diagram, sample data
│   ├── dist/                    # build output (gitignored): lsd-report.html and the demo's lsd-report-payloads.js
│   └── README.md
├── src/main/kotlin/…/report/html/ # the writer (JSON, HTML pages, index)
└── build.gradle.kts             # reportSingle + reportTest; packages ui/dist/lsd-report.html as the jar's shell
```

## What it does

- `LsdContext`: facts, `completeScenario`, `completeReport`, `createIndex`,
  `clear`, id generation and HTML escaping
- The public API is checked: explicit API mode, and an ABI dump in `api/lsd-mono-jvm.api`
  that `check` compares against (see [generated files](../../docs/generated-files.md))
- `completeReport` writes, per report, files named `<title>-<hash>` (the hash is of the report
  key, or of the title when there is no key):
  - `*-diagram.html` — the classpath shell (`/lsd-mono-report-html/lsd-report.single.html`, in lsd-mono-report-html's jar) with the captured
    `ReportJson` injected (the shell falls back to sample data when opened without one)
  - `*-payloads.js` — message bodies, loaded when the inspector opens
  - `*-report.js` — the same report data as a script, which the index page loads when the report is opened
  - `*-report.json` — the report data, as the [report schema](../lsd-mono-report-schema/README.md) describes it, with its `schemaVersion`
  - `index.html` from `createIndex`: the report app for every report in the directory. Reports
    are listed failed first with scenario counts; a report's `*-report.js` loads when it is opened,
    so the page stays small for large suites. `index.html#report=<stem>` opens one report, and
    `#report=<stem>&scenario=<id>` or `&msg=<scenario>/<message>` opens a scenario or message.
  - Files are written to a temporary file and moved into place. There are no shared
    "latest" files, so test classes, forks and modules can share one directory.
- Timing: durations, start times, call/reply pairing and clock ordering, with an accuracy level per scenario (see [Timing](../../docs/jvm-api.md#timing))
- Payloads are copied when captured, with size limits and redaction of secret-looking keys (see [Message data](../../docs/jvm-api.md#message-data))
- The report page shows one scenario at a time. Per scenario: the sequence diagram, the component diagram, timing (summary strip, swim lanes and waterfall) and metrics. A diagram taller than the screen extends the page and scrolls with it, with the toolbar and participant header kept in view. The theme follows the operating system until a fixed theme is chosen

PlantUML and Handlebars output are not supported; the report is drawn by the report UI.

## Component diagram

Each scenario's diagram has two views, **Sequence** and **Components**, picked with the tabs beside its heading. Components draws that scenario's components and the calls between them in place of the sequence diagram, at full size, and scrolls both ways when it is bigger than the card. The report builds the diagram in the browser from the messages it already has, so there is nothing to switch on in the build and no extra file.

The [feature tour](../../README.md#whats-in-a-report) shows it, and so can you in the [live example report](https://lsd-consulting.github.io/lsd-mono/example-report.html).

- Every participant on a sync, async, bi-directional, or lost message is a component, drawn with its participant type (actor, database, queue, and so on). Responses and short arrows add no edges.
- Links carry no captions, so a busy pair of components stays readable. Sync links are solid and async links are dashed, and the head shows the direction. Repeated calls between the same two components share one link with a small count badge.
- Hover over a link to see its messages in its tooltip, for example `Orders to Orders DB, 3 interactions:` then `load basket · sync` on the next line. Click a link, or focus it and press Enter, to list them in the side panel. Each one has a **Show in sequence** button that goes back to the Sequence view with that message open. Escape or Close puts focus back on the link.
- Callers sit above the components they call.
- The view has the same Zoom group, keys and Ctrl/Cmd+wheel as the sequence diagram, kept per scenario. It opens at 100%, where names are 11px. **Overview** fits the whole drawing both ways, down to 10%, and a click in it goes back to 100% there.
- The view you pick stays for the next scenario you open, and is in the URL (`&view=components`), so a reload or a shared link opens it again. Printing prints the view that is shown.

## Capture a scenario by hand

Capture with `LsdContext` from any code, with participant shapes, payloads, facts and activations:

```kotlin
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.ACTOR
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.DATABASE
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.PARTICIPANT
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.QUEUE

val lsd = LsdContext.instance
lsd.addParticipants(
    ACTOR.called("Customer"),
    PARTICIPANT.called("Checkout"),
    DATABASE.called("Orders"),
    QUEUE.called("Order events"),
)
lsd.addFact("orderId", "ord-1001")
lsd.capture {
    "Customer" calls "Checkout" label "POST /orders" data mapOf(
        "method" to "POST",
        "path" to "/orders",
        "status" to 201,
        "body" to mapOf("sku" to "SOCK-1", "qty" to 2),
    )
    activate("Checkout")
    "Checkout" calls "Orders" label "insert order"
    "Orders" repliesTo "Checkout" label "row saved"
    "Checkout" sends "Order events" label "order.placed" data mapOf(
        "orderId" to "ord-1001",
        "sku" to "SOCK-1",
    )
    "Checkout" repliesTo "Customer" label "201 Created"
    deactivate("Checkout")
}
lsd.completeScenario("Place an order", "Customer checks out two pairs of socks.")
val listing = lsd.completeReport("Place an order")
lsd.createIndex()
```

`completeReport` writes under `build/reports/lsd` (set `lsd.mono.report.outputDir` to move it). Open `Place-an-order-1153f62c-diagram.html`: the interactive diagram. `Place-an-order-1153f62c-report.json` holds the data. `completeReport` returns both as `ReportFiles` (`io.github.lsdconsulting.lsd.mono.report.html`: `diagramHtml`, `reportJson`). The 8 characters are a hash of the title, so two titles that read the same as file names (`Place an order`, `Place-an-order`) never overwrite each other. `createIndex()` writes `index.html`: the same report app with every report in the directory in its sidebar (failed first), including ones written by other test JVMs or modules. A report's data loads when you open it, and `index.html#report=<file stem>` links to one report.

Click an arrow to open its JSON. `method`, `path`, and `status` stay on the arrow. Any other fields load from `Place-an-order-1153f62c-payloads.js` when the panel opens.

The participant type is the header shape. `ACTOR` is a person, `DATABASE` a cylinder, `QUEUE` stacked plates. `ENTITY` is a circle and `BOUNDARY` a circle with a bar. Anything else, including `PARTICIPANT`, is a rounded box. Sync responses and async messages draw an arrow head at the destination.

## API reference

The full Kotlin API is in [docs/jvm-api.md](../../docs/jvm-api.md):

- [Capture verbs](../../docs/jvm-api.md#capture-verbs)
- [Capture blocks](../../docs/jvm-api.md#capture-blocks)
- [Interceptors](../../docs/jvm-api.md#interceptors)
- [Timing](../../docs/jvm-api.md#timing)
- [Scenarios and reports in code](../../docs/jvm-api.md#scenarios-and-reports-in-code)
- [Configuration reference](../../docs/jvm-api.md#configuration-reference)
- [Threads and parallel tests](../../docs/jvm-api.md#threads-and-parallel-tests)
- [Message data](../../docs/jvm-api.md#message-data)
- [Escaping](../../docs/jvm-api.md#escaping)

## What this is / is not

| | |
|--|--|
| **Is** | Mono-owned artifact `lsd-mono-jvm`, package `io.github.lsdconsulting.lsd.mono.jvm` |
| **Is not** | A vendor of legacy Maven `io.github.lsd-consulting:lsd-core` sources |
| **Earlier library** | Upstream [lsd-core](https://github.com/lsd-consulting/lsd-core), for comparing behaviour |

## Building the report UI

How to build and test the report UI is in [CONTRIBUTING.md](../../CONTRIBUTING.md#the-report-ui) and [the report UI's README](../lsd-mono-report-html/ui/README.md).
