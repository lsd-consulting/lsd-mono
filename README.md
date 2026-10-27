# LSD: living sequence diagrams for the JVM

[![Maven Central](https://img.shields.io/maven-central/v/io.github.lsd-consulting/lsd-mono-core?label=Maven%20Central)](https://central.sonatype.com/namespace/io.github.lsd-consulting)
[![Build](https://github.com/lsd-consulting/lsd-mono/actions/workflows/gradle.yml/badge.svg?branch=main)](https://github.com/lsd-consulting/lsd-mono/actions/workflows/gradle.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Java 17+](https://img.shields.io/badge/Java-17%2B-informational)
[![Live report](https://img.shields.io/badge/demo-live%20report-brightgreen)](https://lsd-consulting.github.io/lsd-mono/example-report.html)

**Draw how your system really talks: from the tests you already have, or from any code with a small API.** Add a test dependency and each test becomes an interactive sequence diagram: who called whom, with what payload, how long it took, and where it failed. Or call the API yourself to draw a flow by hand, from a `main()`, a sample app, a batch job or a tool. Either way the result is a plain HTML report you can open from CI, attach to a pull request or publish as living documentation.

- **No code for Spring Boot 4:** MVC, WebFlux, `WebTestClient`, `RestClient`, `RestTemplate` and `WebClient`, Kafka, Spring Data, and WebSockets with STOMP, drawn from the `@SpringBootTest`s you already have.
- **One line for http4k 6 and Ktor 3:** server, client and WebSocket filters or plugins, in memory or on real servers.
- **Any JVM test:** JUnit Jupiter 6 and Cucumber 8.
- **Not only tests:** a small Kotlin and Java API draws any flow you describe, by hand or from your own code, and writes it as a report ([example below](#draw-a-flow-without-a-test)).
- **A report people read:** a payload inspector, find across payloads, a component view, a timing waterfall, failed tests first, light, dark and high-contrast themes, and it works offline.

**[See a live report →](https://lsd-consulting.github.io/lsd-mono/example-report.html)** · [Spring Boot sample](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/) · [http4k sample](https://lsd-consulting.github.io/lsd-mono/http4k-6/) (next release) · [Ktor sample](https://lsd-consulting.github.io/lsd-mono/ktor-3/) (next release)

![A tour of the report: choosing a scenario from the list, zooming in and out and back to the default, find, an arrow's JSON in a panel dragged wider, the component diagram, metrics, hiding a participant, the light, dark and high-contrast themes, and the collapsed scenario list](docs/readme/feature-tour.gif)

The [live example report](https://lsd-consulting.github.io/lsd-mono/example-report.html) follows an online shop checkout across 14 services and five scenarios, built from the latest release. Click an arrow to see its request, reply or event payload.

## Draw a flow without a test

The capture API works anywhere on the JVM. This `main()` draws a checkout by hand and writes the report:

```kotlin
import io.lsdconsulting.lsd.mono.core.LsdContext

fun main() {
    val files = LsdContext.instance.report("Checkout flow") {
        scenario("Place an order") {
            capture {
                "Customer" calls "Checkout" label "POST /orders"
                "Checkout" calls "Payments" label "authorise card"
                "Payments" repliesTo "Checkout" label "authorised"
                "Checkout" sends "Order events" label "order.placed"
                "Checkout" repliesTo "Customer" label "201 Created"
            }
        }
    }
    println("Open ${files.diagramHtml}")
}
```

It needs only `lsd-mono-core`. The report goes to `build/reports/lsd` (set `lsd.mono.report.outputDir` to move it), with `index.html` beside it. [Capture a scenario](#capture-a-scenario) shows participants, payloads, facts and activations, and the [lsd-mono-core README](modules/lsd-mono-core/README.md#scenarios-and-reports-in-code) has the Java form.

## Quick start

Pick your stack. Every artifact is `io.github.lsd-consulting:<artifact>:X.Y.Z`, where `X.Y.Z` is the version on the Maven Central badge above, and the report lands in `build/reports/lsd` (open `index.html`).

| Stack | Add (test scope) | Then | Sample |
| --- | --- | --- | --- |
| Spring Boot 4 | `lsd-mono-spring-boot-4` | Nothing: run your `@SpringBootTest`s ([README](modules/lsd-mono-spring-boot-4/README.md)) | [report](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/) |
| http4k 6 (next release) | `lsd-mono-http4k-6` and `lsd-mono-junit-jupiter` | `LsdHttp4k.serverFilter("Shop").then(routes)` ([README](modules/lsd-mono-http4k-6/README.md)) | [report](https://lsd-consulting.github.io/lsd-mono/http4k-6/) |
| Ktor 3 (next release) | `lsd-mono-ktor-3` and `lsd-mono-junit-jupiter` | `install(Lsd) { app = "Shop" }` ([README](modules/lsd-mono-ktor-3/README.md)) | [report](https://lsd-consulting.github.io/lsd-mono/ktor-3/) |
| JUnit Jupiter 6 | `lsd-mono-junit-jupiter` | `@ExtendWith(LsdExtension::class)`, then [capture](#capture-a-scenario) in the test ([README](modules/lsd-mono-junit-jupiter/README.md)) | [report](https://lsd-consulting.github.io/lsd-mono/example-report.html) |
| Cucumber 8 | `lsd-mono-cucumber-8` | `cucumber.plugin=io.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin`, then capture in the steps ([README](modules/lsd-mono-cucumber-8/README.md)) | [report](https://lsd-consulting.github.io/lsd-mono/example-report.html) |

"Next release" means the artifact and its sample report are merged but not yet on Maven Central and the sample site; they go out with the next weekly release.

### Spring Boot 4 in full

Gradle (Kotlin DSL):

```kotlin
dependencies {
    testImplementation("io.github.lsd-consulting:lsd-mono-spring-boot-4:X.Y.Z") // the version on the badge above
}
```

Maven:

```xml
<dependency>
    <groupId>io.github.lsd-consulting</groupId>
    <artifactId>lsd-mono-spring-boot-4</artifactId>
    <version>X.Y.Z</version><!-- the version on the badge above -->
    <scope>test</scope>
</dependency>
```

Nothing changes in the test:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PlaceOrderTest {
    @Test
    void placesAnOrder() { /* call the app as you already do */ }
}
```

Run the tests and open `build/reports/lsd/index.html`: one report per test class, one scenario per test method, with the app's requests, the calls it makes, its Kafka records, repository calls and WebSocket frames. The starter uses the app's own Spring Boot 4 and needs nothing beyond `spring-boot-starter-test`. The [module README](modules/lsd-mono-spring-boot-4/README.md) covers what is drawn and the settings.

## What the report looks like

The tour at the top clicks around a small shop report: four scenarios with every status, six participants, payloads, and durations. [`FeatureTourSample.kt`](modules/lsd-mono-core/src/readme/kotlin/io/lsdconsulting/lsd/mono/core/readme/FeatureTourSample.kt) captures it. The [lsd-mono-core README](modules/lsd-mono-core/README.md#component-diagram) covers the **Components** view.

The report shows one scenario at a time, chosen from the sidebar, and the choice is kept in the URL. Each scenario has:

- the sequence diagram, fitted to its panel, with zoom steps (− and +), the % readout to go back to the default view, an Overview of the whole width, [find](#find-in-the-diagram) and participant hiding. A diagram taller than the screen extends the page and scrolls with it; the toolbar and the participant header stay at the top while you scroll;
- a **Sequence | Components** switch over each diagram, for the scenario's component diagram;
- a side panel for an arrow's JSON (payloads load when the panel opens; secret-looking keys are redacted when captured), a component link's messages, and timing and metrics;
- a timing summary (wall-clock, calls, slowest call, accuracy) with swim lanes and a waterfall, when the scenario has timing.

The theme follows the operating system (dark, light, or more contrast) until you choose one from the theme menu in the top bar, or step through them with `d`.

### Find in the diagram

Find, in the diagram's toolbar, matches arrow labels, notes and message payloads as you type, ignoring case. Enter / Shift+Enter (or F3, Cmd/Ctrl+G, or the ↑ ↓ buttons) step through the matches, wrapping, and the count says where you are: “2 of 11, 3 in payloads”.

- A label match is banded on the label; a payload match bands the arrow's `{}` marker, so you can tell them apart without colour. The arrow's button says “search match in payload” to screen readers.
- A payload is searched as the side panel shows it: indented JSON, keys and values, so `"qty": 2` and header names match too. The payloads load the first time you use Find, from the same file the side panel uses, and a large report is searched in short slices so typing never waits.
- Opening a matching arrow marks every match in its JSON, the first one current and on screen, with its own count and ↑ ↓. Stepping through Find moves an open side panel to the current match; it does not open a closed one.
- The `{}` button at the end of the field (its name is *Payloads*) turns payloads out of Find and back in, for when they match too much. Pressed, it is boxed; off, it is struck through.

### Example report

The [example report](https://lsd-consulting.github.io/lsd-mono/example-report.html) (the live report linked above) is one report that uses every diagram feature, so layout problems are easy to spot. It follows an online shop order across 14 lifelines in five scenarios: a timed checkout, happy path, payment declined (captured out of order), out of stock, and async fulfilment. It covers every participant shape, every arrow type, short arrows to and from the edge, self-calls, nested and overlapping activations, notes, sections, delays, spacers, realistic HTTP, SQL and Kafka payloads with headers, timestamps, and warning and errored scenarios. The timed checkout shows the timing API: measured durations, trace and span ids, events put back in clock order (marked clock-ordered), and the Timing view's swim lanes and waterfall. [`KitchenSinkSample.kt`](modules/lsd-mono-core/src/readme/kotlin/io/lsdconsulting/lsd/mono/core/readme/KitchenSinkSample.kt) captures it. The report is not committed. The [Pages workflow](.github/workflows/pages.yml) builds it from each release, once the release is tagged, so it shows the version the snippets below use, and publishes it with the [`index.html`](https://lsd-consulting.github.io/lsd-mono/) that `createIndex()` writes for it.

## Getting started

The artifacts are on Maven Central under `io.github.lsd-consulting`, all eight on one version. Releases go out weekly, on Tuesday mornings (UK time) when there is something to release ([docs/releasing.md](docs/releasing.md#when-releases-happen)), so the snippets below say `X.Y.Z` instead of a version: use the latest, which the Maven Central badge above shows. The [release notes](https://github.com/lsd-consulting/lsd-mono/releases) say what changed in each. Until v1 they are `0.y.z`, and a minor release may change the API ([docs/releasing.md](docs/releasing.md)). They run on Java 17 or later, except `lsd-mono-http4k-6`, which needs Java 21 (as http4k 6 does).

| Artifact | Use it for |
| --- | --- |
| `lsd-mono-core` | The capture API (`LsdContext`) and the HTML report. Always needed. |
| `lsd-mono-junit-jupiter` | A scenario per JUnit Jupiter 6 test ([README](modules/lsd-mono-junit-jupiter/README.md)). |
| `lsd-mono-cucumber-8` | A scenario per Cucumber 8 scenario ([README](modules/lsd-mono-cucumber-8/README.md)). |
| `lsd-mono-coroutines` | Captures from coroutines that change threads, with kotlinx.coroutines 1 ([README](modules/lsd-mono-coroutines/README.md)). |
| `lsd-mono-spring-boot-4` | A scenario per `@SpringBootTest` method with no code, for Spring Boot 4: Spring MVC and WebFlux, `WebTestClient`, `RestClient`, `RestTemplate` and `WebClient` (server-sent events included), Kafka sends, failed sends and consumes (batches included), Spring Data repository calls, and WebSockets with STOMP, across `@Async` and reactive thread hops ([README](modules/lsd-mono-spring-boot-4/README.md)). |
| `lsd-mono-http4k-6` | http4k 6 filters that draw the requests an app serves, the calls it makes and its WebSockets, in memory or on real servers; Java 21, as http4k 6 is ([README](modules/lsd-mono-http4k-6/README.md)). |
| `lsd-mono-report-model` | The report as plain Kotlin values, for a producer that writes reports without lsd-mono-core ([README](modules/lsd-mono-report-model/README.md)). lsd-mono-core brings it. |
| `lsd-mono-report-html` | Writes a report as JSON and as the HTML page, with the report UI bundled ([README](modules/lsd-mono-report-html/README.md)). lsd-mono-core brings it. |

`lsd-mono-http4k-6` is merged but not on Maven Central yet: it is published with the next weekly release, and until then the snippets below will not resolve it. Leave it out, or build it from this repository ([CONTRIBUTING.md](CONTRIBUTING.md#from-this-repository)).

Gradle (Kotlin DSL), with the integrations you use:

```kotlin
val lsdMonoVersion = "X.Y.Z" // the latest version: see the Maven Central badge above

dependencies {
    testImplementation("io.github.lsd-consulting:lsd-mono-core:$lsdMonoVersion")
    testImplementation("io.github.lsd-consulting:lsd-mono-junit-jupiter:$lsdMonoVersion")
    testImplementation("io.github.lsd-consulting:lsd-mono-cucumber-8:$lsdMonoVersion")
    testImplementation("io.github.lsd-consulting:lsd-mono-coroutines:$lsdMonoVersion")
    testImplementation("io.github.lsd-consulting:lsd-mono-spring-boot-4:$lsdMonoVersion")
    testImplementation("io.github.lsd-consulting:lsd-mono-http4k-6:$lsdMonoVersion")
}
```

Maven:

```xml
<properties>
    <!-- the latest version: see the Maven Central badge above -->
    <lsd-mono.version>X.Y.Z</lsd-mono.version>
</properties>

<dependencies>
    <dependency>
        <groupId>io.github.lsd-consulting</groupId>
        <artifactId>lsd-mono-core</artifactId>
        <version>${lsd-mono.version}</version>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>io.github.lsd-consulting</groupId>
        <artifactId>lsd-mono-junit-jupiter</artifactId>
        <version>${lsd-mono.version}</version>
        <scope>test</scope>
    </dependency>
    <!-- lsd-mono-cucumber-8, lsd-mono-coroutines, lsd-mono-spring-boot-4 and lsd-mono-http4k-6 the same way -->
</dependencies>
```

Each integration brings in `lsd-mono-core`; listing core as well keeps the API you call directly declared. You still bring the test runtime: a JUnit Jupiter engine for `lsd-mono-junit-jupiter`, and Cucumber 8 (`cucumber-java8` and `cucumber-junit-platform-engine`) for `lsd-mono-cucumber-8`; `lsd-mono-spring-boot-4` uses the app's own Spring Boot 4 and `spring-boot-starter-test`, and `lsd-mono-http4k-6` the app's own http4k 6. The module READMEs show the setup for each.

## Capture a scenario

The integrations above capture for you. To draw anything else, from any JVM code, capture it yourself with `LsdContext`:

```kotlin
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE

val lsd = LsdContext()
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

`completeReport` writes under `build/reports/lsd` (set `lsd.mono.report.outputDir` to move it). Open `Place-an-order-1153f62c-diagram.html`: the interactive diagram. `Place-an-order-1153f62c-report.json` holds the data. `completeReport` returns both as `ReportFiles` (`diagramHtml`, `reportJson`). The 8 characters are a hash of the title, so two titles that read the same as file names (`Place an order`, `Place-an-order`) never overwrite each other. `createIndex()` writes `index.html`: the same report app with every report in the directory in its sidebar (failed first), including ones written by other test JVMs or modules. A report's data loads when you open it, and `index.html#report=<file stem>` links to one report.

Click an arrow to open its JSON. `method`, `path`, and `status` stay on the arrow. Any other fields load from `Place-an-order-1153f62c-payloads.js` when the panel opens.

The participant type is the header shape. `ACTOR` is a person, `DATABASE` a cylinder, `QUEUE` stacked plates. `ENTITY` is a circle and `BOUNDARY` a circle with a bar. Anything else, including `PARTICIPANT`, is a rounded box. Sync responses and async messages draw an arrow head at the destination.

## From a JUnit test

See the [JUnit Jupiter module README](modules/lsd-mono-junit-jupiter/README.md) for the extension setup and capture example. It completes each test scenario and writes the report after the class.

## From a Cucumber scenario

See the [Cucumber 8 module README](modules/lsd-mono-cucumber-8/README.md) for plugin registration, step definitions, and the capture example. It completes each scenario and writes one report per feature when the run finishes.

## Parallel tests

Capture is thread-safe, and both integrations support parallel runs (JUnit's `junit.jupiter.execution.parallel.enabled`, Cucumber's `cucumber.execution.parallel.enabled`). Each test or scenario gets its own buffer, bound to the thread that runs it, so `LsdContext.instance.capture` in a test lands in that test. Each test class or feature gets its own report.

A thread that is not bound to a test, such as an HTTP server thread, captures into the running test when only one test is running. When several are running, LSD cannot tell which test the capture belongs to: it logs a warning and keeps the capture out of all of them. Carry the test onto threads you start with `LsdContext.instance.wrap(task)` or `lsd.currentScenario()?.bind()`. A coroutine that changes dispatcher thread drops a thread binding; use `withLsdScenario` from the [coroutines module](modules/lsd-mono-coroutines/README.md).

## Configuration

Every setting is a `lsd.mono.*` property, read from a system property, an environment variable
(`LSD_MONO_REPORT_OUTPUTDIR`), a JUnit configuration parameter, or `lsd-mono.properties` on the
classpath, in that order. The [configuration reference](modules/lsd-mono-core/README.md#configuration-reference)
lists each one with its default; a test keeps that table in step with the code.

## Usage ping

[![jsDelivr hits](https://data.jsdelivr.com/v1/package/gh/lsd-consulting/lsd-mono/badge)](https://www.jsdelivr.com/package/gh/lsd-consulting/lsd-mono)

A report written by a release of lsd-mono (not a `-SNAPSHOT` build) counts towards jsDelivr's public hit count, the number on the jsDelivr badge here. When the report opens, the page requests one tiny file from jsDelivr, pinned to the version that wrote the report:

```text
https://cdn.jsdelivr.net/gh/lsd-consulting/lsd-mono@<version>/ping/<event>.txt
```

- **Events.** `report-open` when a report or the index page opens. `source-junit`, `source-cucumber` or `source-api` for the integration that wrote the report. `metrics-open` when the Metrics view is opened, and `components-open` when a scenario's Components view is shown. Each event is one file under [`ping/`](ping) and is requested at most once per page load.
- **What is sent.** Only the request: the version and the event, in the path. There is no query string, cookie or referrer, and no report title, scenario data or ids. Like any request, it shows jsDelivr your IP address and browser User-Agent ([jsDelivr's privacy policy](https://www.jsdelivr.com/terms/privacy-policy)). We only read jsDelivr's public totals per file and version.
- **The report doesn't depend on it.** The request is never awaited and a failure is ignored, so a report opened offline, from `file://`, or behind a proxy or Content-Security-Policy that blocks jsDelivr works and looks the same.
- **Turn it off** with `lsd.mono.report.usagePing=false`, set like any other [property](#configuration) (for example `LSD_MONO_REPORT_USAGEPING=false`). The setting is written into the report, and `false` means the page makes no request at all.

Snapshot builds, the report UI's dev server and checks, and the sample reports this repository publishes never ping.

## Contributing

Building lsd-mono, depending on the modules from another project in this build, the source layout, regenerating the README tour and building the sample site locally are in [CONTRIBUTING.md](CONTRIBUTING.md). [Generated files](docs/generated-files.md) lists every generated file, and [CI](docs/ci.md) describes the workflows.

Coming from the earlier LSD libraries? Their behaviour is upstream at [lsd-core](https://github.com/lsd-consulting/lsd-core); it is not in this tree.

## License

MIT. See [LICENSE](LICENSE).
