# LSD: living sequence diagrams

[![Maven Central](https://img.shields.io/maven-central/v/io.github.lsd-consulting/lsd-mono-jvm?label=Maven%20Central)](https://central.sonatype.com/namespace/io.github.lsd-consulting)
[![Build](https://github.com/lsd-consulting/lsd-mono/actions/workflows/gradle.yml/badge.svg?branch=main)](https://github.com/lsd-consulting/lsd-mono/actions/workflows/gradle.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Live report](https://img.shields.io/badge/demo-live%20report-brightgreen)](https://lsd-consulting.github.io/lsd-mono/example-report.html)

**See how your system really talks.** Interactive sequence diagrams of the calls, messages and payloads between your services, drawn from your tests, from your own code, or by hand.

Each diagram shows who called whom, with what payload, how long it took, and where it failed. Capture them automatically from the tests you already run, call the API from any code (a sample app, a batch job, a tool), or describe a flow by hand. Every report is a static HTML page backed by a documented JSON format, so you can open it from CI, attach it to a pull request, or publish it as documentation that stays true to the code.

- **Automatic from your tests:** no code for Spring Boot (MVC, WebFlux, HTTP clients, Kafka, Spring Data and WebSockets), one line for http4k and Ktor ([supported stacks](#supported-stacks-today)).
- **Not only tests:** draw any flow from your own code or by hand ([example](#draw-a-flow-without-a-test)).
- **A report people read:** a payload inspector, find across payloads, a component view, a timing waterfall, failed tests first, light, dark and high-contrast themes, and it works offline.

**[See a live report →](https://lsd-consulting.github.io/lsd-mono/example-report.html)** (an online shop checkout across 14 services) · [Spring Boot sample](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/) · [http4k sample](https://lsd-consulting.github.io/lsd-mono/http4k-6/) · [Ktor sample](https://lsd-consulting.github.io/lsd-mono/ktor-3/)

[![A still from the report tour: the Online shop report with its scenario list, timing summary, description and sequence diagram. Select it to play the animated tour: choosing a scenario, zoom, find, an arrow's JSON, the component diagram, metrics, hiding a participant, the themes and the collapsed scenario list](docs/readme/feature-tour.png)](docs/readme/feature-tour.gif)

*A still from the tour. [Play the animated tour (GIF)](docs/readme/feature-tour.gif).*

## Supported stacks today

### JVM (Kotlin, Java)

<!-- release-version:start (the release workflow updates the versions up to the end marker) -->

Every artifact is `io.github.lsd-consulting:<artifact>:0.15.0`; the snippets below show 0.15.0, and the Maven Central badge above shows the latest version. They run on Java 17 or later (`lsd-mono-http4k-6` needs Java 21, as http4k 6 does), and the report lands in `build/reports/lsd` (open `index.html`).

| Stack | Add (test scope) | Then | Sample |
| --- | --- | --- | --- |
| Spring Boot 4 | `lsd-mono-spring-boot-4` | Nothing: run your `@SpringBootTest`s ([README](modules/lsd-mono-spring-boot-4/README.md)) | [report](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/) |
| http4k 6 | `lsd-mono-http4k-6` and `lsd-mono-junit-jupiter` | `LsdHttp4k.serverFilter("Shop").then(routes)` ([README](modules/lsd-mono-http4k-6/README.md)) | [report](https://lsd-consulting.github.io/lsd-mono/http4k-6/) |
| Ktor 3 | `lsd-mono-ktor-3` and `lsd-mono-junit-jupiter` | `install(Lsd) { app = "Shop" }` ([README](modules/lsd-mono-ktor-3/README.md)) | [report](https://lsd-consulting.github.io/lsd-mono/ktor-3/) |
| JUnit Jupiter 6 | `lsd-mono-junit-jupiter` | `@ExtendWith(LsdExtension::class)`, then [capture](#draw-a-flow-without-a-test) in the test ([README](modules/lsd-mono-junit-jupiter/README.md)) | – |
| Cucumber 8 | `lsd-mono-cucumber-8` | `cucumber.plugin=io.github.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin`, then capture in the steps ([README](modules/lsd-mono-cucumber-8/README.md)) | – |

Each integration brings in `lsd-mono-jvm` and uses your own test runtime and framework. For coroutines, or for writing reports without `lsd-mono-jvm`, see [which artifact to depend on](modules/README.md#which-artifact-to-depend-on).

#### Spring Boot 4 in full

[![Maven Central: lsd-mono-spring-boot-4](https://img.shields.io/maven-central/v/io.github.lsd-consulting/lsd-mono-spring-boot-4?label=lsd-mono-spring-boot-4)](https://central.sonatype.com/artifact/io.github.lsd-consulting/lsd-mono-spring-boot-4)

Gradle (Kotlin DSL):

```kotlin
dependencies {
    testImplementation("io.github.lsd-consulting:lsd-mono-spring-boot-4:0.15.0")
}
```

Maven:

```xml
<dependency>
    <groupId>io.github.lsd-consulting</groupId>
    <artifactId>lsd-mono-spring-boot-4</artifactId>
    <version>0.15.0</version>
    <scope>test</scope>
</dependency>
```

<!-- release-version:end -->

Nothing changes in the test:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PlaceOrderTest {
    @Test
    void placesAnOrder() { /* call the app as you already do */ }
}
```

Run the tests and open `build/reports/lsd/index.html`: one report per test class, one scenario per test method. The [module README](modules/lsd-mono-spring-boot-4/README.md) covers what is drawn and the settings.

## Draw a flow without a test

The API (Kotlin and Java today) draws a flow from any code. This `main()` draws a checkout by hand and writes the report:

```kotlin
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext

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

It needs only `lsd-mono-jvm`. Participants, payloads, facts, activations, the file names and the Java form are in the [lsd-mono-jvm README](modules/lsd-mono-jvm/README.md#capture-a-scenario-by-hand).

## What's in a report

- one scenario at a time, chosen from the sidebar, with zoom, an overview, participant hiding and a **Sequence | Components** switch;
- a side panel for an arrow's JSON (secret-looking keys are redacted when captured), a component link's messages, and timing and metrics;
- find across labels, notes and payloads, with keyboard shortcuts and screen-reader labels;
- a timing summary with swim lanes and a waterfall, when the scenario has timing;
- an index of every report in the directory, failed first;
- light, dark and high-contrast themes, and it works offline.

The [report UI guide](docs/report.md) has the details.

## Parallel tests

Capture is thread-safe, and both integrations support parallel runs (JUnit's `junit.jupiter.execution.parallel.enabled`, Cucumber's `cucumber.execution.parallel.enabled`). Each test or scenario gets its own buffer, bound to the thread that runs it, so `LsdContext.instance.capture` in a test lands in that test. Each test class or feature gets its own report.

A thread that is not bound to a test, such as an HTTP server thread, captures into the running test when only one test is running. When several are running, LSD cannot tell which test the capture belongs to: it logs a warning and keeps the capture out of all of them. Carry the test onto threads you start with `LsdContext.instance.wrap(task)` or `lsd.currentScenario()?.bind()`. A coroutine that changes dispatcher thread drops a thread binding; use `withLsdScenario` from the [coroutines module](modules/lsd-mono-coroutines/README.md).

## Configuration

Every setting is a `lsd.mono.*` property, read from a system property, an environment variable (`LSD_MONO_REPORT_OUTPUTDIR`), a JUnit configuration parameter, or `lsd-mono.properties` on the classpath, in that order. The [configuration reference](docs/jvm-api.md#configuration-reference) lists each one with its default; a test keeps that table in step with the code.

## Usage ping

A report page from a release opens one tiny, never-awaited request to jsDelivr naming only the version and the event, so we can count use; no report data is sent, and the report works the same offline. Turn it off with `lsd.mono.report.usagePing=false`. [docs/usage-ping.md](docs/usage-ping.md) has the events and details.

## Versions and releases

Releases go out weekly, usually on Tuesday mornings (UK time), when there is something to release, and every artifact shares one version ([docs/releasing.md](docs/releasing.md#when-releases-happen)). The [release notes](https://github.com/lsd-consulting/lsd-mono/releases) say what changed. Until v1 they are `0.y.z`, and a minor release may change the API.

### Moving from lsd-mono-core

`lsd-mono-core` is now `lsd-mono-jvm` ([#126](https://github.com/lsd-consulting/lsd-mono/issues/126)), and every package moved from `io.lsdconsulting.lsd.mono` to `io.github.lsdconsulting.lsd.mono`, matching the `io.github.lsd-consulting` group:

| | Before | Now |
| --- | --- | --- |
| Core artifact | `io.github.lsd-consulting:lsd-mono-core` | `io.github.lsd-consulting:lsd-mono-jvm` |
| Core package | `io.lsdconsulting.lsd.mono.core` | `io.github.lsdconsulting.lsd.mono.jvm` |
| Other modules' packages | `io.lsdconsulting.lsd.mono.*` | `io.github.lsdconsulting.lsd.mono.*` |

To move:

- **Change the dependency** from `lsd-mono-core` to `lsd-mono-jvm`. The other artifacts keep their names.
- **Replace the imports:** `io.lsdconsulting.lsd.mono.core` first, then `io.lsdconsulting.lsd.mono`.
- **The relocation POM exists only for 0.15.0.** v0.15.0, the release that renamed it, published `lsd-mono-core` 0.15.0 as a relocation, so Maven follows that version to `lsd-mono-jvm` with a warning; the imports still have to change. On an earlier version, change the coordinate by hand.

### Coming from the earlier LSD libraries

Their behaviour is upstream at [lsd-core](https://github.com/lsd-consulting/lsd-core); it is not in this tree.

## Contributing

Building lsd-mono, depending on the modules from another project in this build, the source layout, regenerating the README tour and building the sample site locally are in [CONTRIBUTING.md](CONTRIBUTING.md). [Generated files](docs/generated-files.md) lists every generated file, and [CI](docs/ci.md) describes the workflows.

## License

MIT. See [LICENSE](LICENSE).
