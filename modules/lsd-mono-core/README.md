# lsd-mono-core

The core of LSD Mono: a Kotlin capture API (`LsdContext`), timing analysis, and the writer that
produces the report JSON and the interactive HTML report. The report UI lives in `report/`
(Vite, TypeScript and a custom SVG diagram). The JUnit, Cucumber and coroutines integrations
depend on this module only.

Depend on `io.github.lsd-consulting:lsd-mono-core` from Maven Central; [Getting started](../../README.md#getting-started) in the root README has the Gradle and Maven snippets and the latest version.

## What this is / is not

| | |
|--|--|
| **Is** | Mono-owned artifact `lsd-mono-core`, package `io.lsdconsulting.lsd.mono.core` |
| **Is** | Report UI in `report/` (`modules/lsd-mono-core/report`) |
| **Is not** | A vendor of legacy Maven `io.github.lsd-consulting:lsd-core` sources |
| **Earlier library** | Upstream [lsd-core](https://github.com/lsd-consulting/lsd-core), for comparing behaviour |

## Layout

```
lsd-mono-core/
├── report/                 # Vite+TS report UI (dev with npm)
│   ├── src/                     # UI, custom SVG diagram, sample data
│   ├── dist/                    # build output (gitignored): lsd-report.html and the demo's lsd-report-payloads.js
│   └── README.md
├── src/main/kotlin/…/mono/core/ # Kotlin façade (capture + write reports)
└── build.gradle.kts                 # reportSingle + reportTest; packages dist/lsd-report.html as the jar's shell
```

## What it does

- `LsdContext`: facts, `completeScenario`, `completeReport`, `createIndex`,
  `clear`, id generation and HTML escaping
- The public API is checked: explicit API mode, and an ABI dump in `api/lsd-mono-core.api`
  that `check` compares against (see [generated files](../../docs/generated-files.md))
- `completeReport` writes, per report, files named `<title>-<hash>` (the hash is of the report
  key, or of the title when there is no key):
  - `*-diagram.html` — the classpath shell (`/lsd-mono-core/report/lsd-report.single.html`) with the captured
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
- Timing: durations, start times, call/reply pairing and clock ordering, with an accuracy level per scenario (see [Timing](#timing))
- Payloads are copied when captured, with size limits and redaction of secret-looking keys (see [Message data](#message-data))
- The report page shows one scenario at a time. Per scenario: the sequence diagram, the component diagram, timing (summary strip, swim lanes and waterfall) and metrics. A diagram taller than the screen extends the page and scrolls with it, with the toolbar and participant header kept in view. The theme follows the operating system until a fixed theme is chosen

PlantUML and Handlebars output are not supported; the report is drawn by the report UI.

## Component diagram

Each scenario's diagram has two views, **Sequence** and **Components**, picked with the tabs beside its heading. Components draws that scenario's components and the calls between them in place of the sequence diagram, at full size, and scrolls both ways when it is bigger than the card. The report builds the diagram in the browser from the messages it already has, so there is nothing to switch on in the build and no extra file.

The [feature tour](../../README.md) shows it, and so can you in the [live example report](https://lsd-consulting.github.io/lsd-mono/example-report.html).

- Every participant on a sync, async, bi-directional, or lost message is a component, drawn with its participant type (actor, database, queue, and so on). Responses and short arrows add no edges.
- Links carry no captions, so a busy pair of components stays readable. Sync links are solid and async links are dashed, and the head shows the direction. Repeated calls between the same two components share one link with a small count badge.
- Hover over a link to see its messages in its tooltip, for example `Orders to Orders DB, 3 interactions:` then `load basket · sync` on the next line. Click a link, or focus it and press Enter, to list them in the side panel. Each one has a **Show in sequence** button that goes back to the Sequence view with that message open. Escape or Close puts focus back on the link.
- Callers sit above the components they call.
- The view has the same Zoom group, keys and Ctrl/Cmd+wheel as the sequence diagram, kept per scenario. It opens at 100%, where names are 11px. **Overview** fits the whole drawing both ways, down to 10%, and a click in it goes back to 100% there.
- The view you pick stays for the next scenario you open, and is in the URL (`&view=components`), so a reload or a shared link opens it again. Printing prints the view that is shown.

## Kotlin API

The entry points follow lsd-core's (`LsdContext`, `Status`, properties, clickable arrows), in the
`io.lsdconsulting.lsd.mono` packages:

```kotlin
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.Status

val lsd = LsdContext.instance
lsd.addFact("framework", "junit-jupiter-6")
lsd.completeScenario("my scenario", "<p>ok</p>", Status.SUCCESS)
lsd.completeReport("My Suite")
lsd.createIndex()
```

### Capture verbs

`LsdContext` (which captures into the current scenario), `LsdScenario` (which
captures into itself) and a capture block (below) share the same verbs, from their
`Capturer` base class. On the context or a scenario, each call records one event at once:

| Verb | Draws |
| --- | --- |
| `message(from, to, label, data, type, colour, timing, trace)` | An arrow; a synchronous call unless `type` says otherwise |
| `response(from, to, label, data, timing, trace, replyTo)` | The reply to a call |
| `call(from, to, label, data, timing, trace)` | A call now, returning a `PendingCall`; its `reply(label, data, timing)` or `fail(error, timing)` draws the timed response later (see [Interceptors](#interceptors)) |
| `async(from, to, label, data, timing, trace, causedBy)` | An asynchronous message, such as an event on a queue |
| `inbound(to, label, timing)` / `outbound(from, label, timing)` | A short arrow from or to the edge of the diagram |
| `note(text, on, side, at)` | A note over `on`, or beside it with `side = NoteSide.LEFT` or `RIGHT`. `on` is required; pass `on = null` with `LEFT` or `RIGHT` for a note at the diagram's edge |
| `activate(participant, colour, at)` / `deactivate(participant, at)` | An activation bar |
| `section(title, at)`, `divider(label, at)`, `delay(label, at)`, `spacer(heightPx, at)` | Rows that structure the diagram |
| `addFact(key, value)` | A fact shown with the scenario |

Everything after the first required arguments is optional. A message's timing is one
[`Timing`](#timing): `Timing.at(instant)` (when it started), `Timing.tookMs(12.5)` or
`Timing.took(duration)` (measured), `Timing.of(instant, duration)`, plus its clock `source`. The
report orders timed messages by their start, for capture that arrives out of order. Structural
rows take `at`, an `Instant`. From Java, the overloads cover the common calls
(`lsd.message("A", "B", "label", body)`). To pass `timing`, pass `null` for the optional
parameters before it: a `null` type means
`MessageType.SYNCHRONOUS`. `message(from, to, label, MessageType.LOST)` sets the type, from
Kotlin and Java alike: a type in the fourth position is never taken as `data`, and Java's
`message(from, to, label, null)` is a plain synchronous message.

### Capture blocks

A capture block writes several events together, with arrows for the messages:

```kotlin
lsd.capture {
    "Customer" calls "Orders" label "POST /orders" data body took 412
    activate("Orders")
    "Orders" sends "order-events" label "order.paid"
    note("idempotent by orderId", on = "Orders")
    "Orders" repliesTo "Customer" label "201 Created"
    deactivate("Orders")
}
```

| Arrow | Draws |
| --- | --- |
| `"A" calls "B"` | A synchronous call |
| `"B" repliesTo "A"` | The reply to a call |
| `"A" sends "B"` | An asynchronous message |

Each arrow takes `label`, `data`, `took` (milliseconds, fractional allowed), `startedAt` (an
`Instant`), `timing` (a whole `Timing`), `source`, `trace` and `colour`, in any order.
The arrows exist only inside a block; every verb above works there too, including
`message(from, to, label, MessageType.LOST)` for the other arrow types.

The block picks its scenario once, when it starts, and adds its events together when it
ends, even if it throws. So events from other threads never land between them. Message
data is still copied when its line runs. Use the block's receiver only inside the block.

`lsd { … }` is shorthand for `LsdContext.instance.capture { … }`. Inside a class with
its own `val lsd`, write `lsd.capture { … }`. From Java, pass a lambda:

```java
lsd.capture(c -> {
    c.calls("Customer", "Orders").label("POST /orders").data(body);
    c.activate("Orders");
});
```

### Interceptors

An interceptor sees a request go out and its response come back, often on another thread.
`call` captures the request and returns a `PendingCall`. `reply` draws the response from the
callee back to the caller, with the time since the call as its duration, in the scenario the
call was made in, whichever thread replies. `fail(error)` draws an error reply named after the
exception, with its class and message as data.

```kotlin
class LsdHttpInterceptor(private val lsd: LsdContext = LsdContext.instance) : ClientHttpRequestInterceptor {
    override fun intercept(req: HttpRequest, body: ByteArray, exec: ClientHttpRequestExecution): ClientHttpResponse {
        val call = lsd.call("Test", "Orders", "${req.method} ${req.uri.path}", data = mapOf("headers" to req.headers, "body" to body))
        val res =
            try {
                exec.execute(req, body)
            } catch (e: IOException) {
                call.fail(e)
                throw e
            }
        call.reply(res.statusCode.toString(), data = mapOf("headers" to res.headers))
        return res
    }
}
```

Only the first `reply` or `fail` counts; another is ignored with a warning. A call still
waiting when its scenario completes is listed in a warning, and a later reply is dropped.
`call` does not draw activation bars; add `activate` and `deactivate` around it if you want them.
In a capture block, a reply that comes before the block ends keeps its place among the
block's events.

A message that crosses a queue can carry its scenario in a header. `LsdHeaders.SCENARIO`
(`lsd-scenario`) is the name to use, for HTTP too. Its value is the scenario's
`correlationId`, a random id that says nothing about the test (the scenario `key` is often
the test's name, so it is never sent). Ask `lsd.scenarioHeaderValue(host)` for it, and add
the header only when that is not null: it is null when no scenario is current or when the
target host is not allowed. Only loopback hosts are allowed by default, so an interceptor
never tags calls to a third party; allow more with `lsd.mono.propagation.allowedHosts`
(`orders.test,*.internal.example`, or `*` for every host). The receiving side finds the
scenario with `lsd.findScenarioByHeader(value)`.

```kotlin
// HTTP client interceptor
lsd.scenarioHeaderValue(request.uri())?.let { builder.header(LsdHeaders.SCENARIO, it) }

// Kafka producer interceptor (brokerHost: the host of the bootstrap server)
override fun onSend(record: ProducerRecord<String, String>) =
    record.also { r ->
        lsd.scenarioHeaderValue(brokerHost)?.let { r.headers().add(LsdHeaders.SCENARIO, it.toByteArray()) }
        lsd.async("Orders", r.topic(), "publish ${r.key()}", data = r.value())
    }

// Kafka consumer interceptor: the poll thread is not bound to a scenario
override fun onConsume(records: ConsumerRecords<String, String>) =
    records.also {
        it.forEach { r ->
            val target: Capturer =
                r.headers().lastHeader(LsdHeaders.SCENARIO)?.let { h -> lsd.findScenarioByHeader(String(h.value())) } ?: lsd
            target.async(r.topic(), "Orders", "consume ${r.key()}", data = r.value(), timing = Timing.at(Instant.ofEpochMilli(r.timestamp())))
        }
    }
```

`Timing.at` puts consumption that arrives out of order back in time order.

From Java:

```java
PendingCall call = lsd.call("Client", "Orders", "POST /orders", body);
call.reply("201 Created", responseBody);
```

#### Interceptors never fail the request

What an interceptor calls never throws into the application because something went wrong
inside LSD: the capture verbs on `LsdContext` and `LsdScenario`, `call` with
`PendingCall.reply` and `fail`, `scenarioHeaderValue` and `findScenarioByHeader`. A failure,
such as a payload converter that throws an `Error`, is logged through `System.Logger` and the
event is dropped, so the diagram is missing that event but the request goes on. The first
failure of each kind (event, fact, call, reply, scenario header) is a WARNING with its stack
trace; later ones are DEBUG. A `VirtualMachineError` such as `OutOfMemoryError` still
propagates. A `call` that could not be captured returns a call whose replies are ignored.

The test DSL stays strict, because a mistake there is in the test and should fail it:

- `note(side = OVER)` with no `on` throws `IllegalArgumentException`;
- a `capture { }` receiver used after its block throws `IllegalStateException`;
- `beginScenario` with the key of a running scenario throws `IllegalStateException`;
- from Java, `null` for a parameter that is not nullable throws `NullPointerException`
  (a label from a header that may be absent needs `Objects.requireNonNullElse(value, "")`).

Payload conversion has always been safe as well (see [Message data](#message-data)).

### Timing

Timing is optional: a report with none is a valid structural sketch, and each fact a caller adds
makes it more accurate. Every message verb takes a `Timing` and a `Trace`:

```kotlin
// Measured automatically: the time between call() and reply(), in fractional ms.
lsd.call("web", "api", "POST /orders").reply("201")
// Measured by the caller, with a start time, a clock source and trace ids.
lsd.call("api", "payments", "authorise",
    timing = Timing.of(sentAt, Duration.ofNanos(652_250_000)),
    trace = Trace(traceId, spanId = "s2", parentSpanId = "s1")).reply("ok")
// Publish and consume, linked so the consume is never drawn before its publish.
val placed = lsd.async("orders", "kafka", "order.placed", timing = Timing.at(t1).withSource("orders"))
lsd.async("kafka", "billing", "consume", timing = Timing.at(t2), causedBy = placed)
// From another library (an interceptor or importer): LsdContext is an InteractionSink.
lsd.accept(Interaction(InteractionKind.RESPONSE, "payments", "api", "200", replyTo = callId, durationMs = 12.5))
```

An `Interaction`'s `headers` (HTTP or record headers) are shown with its payload as
`{ "headers": …, "body": data }`, and are redacted like any other map key.

Each message in the JSON carries `seq` (capture order), `timing` (`NONE`, `TIMESTAMPED`,
`MEASURED`, `DERIVED`), `pairing` for calls and replies (`NONE`, `GUESSED`, `CALL_ID`, `TRACE`)
and `order` (`SEQUENCE`, `STRUCTURE`, `CLOCK`), plus `callId`, `replyTo`, `causedBy`, `trace`,
`source` and `startedAt` when known. `parentId` names the call a message runs inside (its
`parentSpanId`, else the innermost open call) and `replyOf` the call a paired reply answers: the
Timing view draws its tree from these, so it always matches the library's pairing. `durationMs` is fractional and sits on the call: a call carries
its own duration or its reply's, and a paired reply carries none. Each scenario carries `accuracy`
(`STRUCTURE_ONLY`, `TIMESTAMPED`, `MEASURED`, `TRACED`), `measuredCoverage`, `pairingCoverage`,
`sources`, `wallClockMs` (single source only), `clockOrdering`, `clockOrdered` and `warnings`, each
`{ kind, message }` with `kind` one of `REPLY_WITHOUT_CALL`, `DURATION_ON_REPLY_DROPPED`,
`LONGER_THAN_PARENT`, `DUPLICATE_SPAN` or `SKEW`. When
participant pairs differ, `pairAccuracy` lists `{ from, to, accuracy }` per pair (a reply counts with
its call), and the Timing view shows it as "Accuracy by pair", its last section (folded under a count per
accuracy when there are more than six pairs; the card's Accuracy chip opens the panel there).

An interaction's `status` is written on its message. When any message in a scenario has one, the
metrics add `Errors`: the number whose status is an error, either an HTTP-style code from 400 to 599
(`"503"`, `"404 Not Found"`) or, with no leading code, a word such as `error`, `failed` or `timeout`.
The inspector labels an error status `· error`.

**Clock ordering** (`lsd.mono.timing.orderByStartedAt`, or `lsd.configure { it.orderByStartedAt(mode) }`,
`lsd.configure(t -> t.orderByStartedAt(mode))` from Java): by
default (`source`) events from one source that have a start time but no measured duration are
ordered by it, among their siblings in the same parent call; untimed events keep their place.
`all` also compares different sources, `false` turns it off, and `Timing.orderByStartedAt` opts
one event in or out. Moved events are marked `order: CLOCK` and badged CLOCK in the waterfall and
the inspector; it never raises `accuracy`. A
reply never moves before its call, a consume before its publish, or a child out of its parent:
clock order that would do so is ignored, with a `skew` warning. Under `all`, when two sources'
clocks disagree with the structure, only that pair is kept apart: their events keep their captured
interleaving (each still ordered by its own clock), other sources stay clock-ordered against them,
and the warning names that pair. A break no source pair explains keeps capture order for the group.

### Scenarios and reports in code

Samples, `main()` programs and frameworks without an integration can scope scenarios and
reports with blocks instead of `beginScenario` / `completeScenario` / `completeReport`:

```kotlin
val files = LsdContext.instance.report("Online shop") {
    scenario("Place an order", description = "Given … When … Then …") {
        addFact("orderId", "ord-1001")
        capture { "Customer" calls "Web Shop" label "click Place order" }
        placeOrder()            // real code; its interceptors capture into this scenario
    }
    scenario("Card declined") { … }
}
```

- `scenario { }` binds the calling thread to a new scenario, runs the block, and completes
  it as a success. If the block throws, it completes it as an error with the exception and
  rethrows. Afterwards the thread is bound to whatever it was bound to before, so a nested
  `scenario { }` shadows the outer one until it ends. It returns the block's value.
- `report { }` writes the report (and `index.html`) when the block ends, even if it throws,
  and returns its `ReportFiles` (open `files.diagramHtml`). It has its own report key, so `report { }` blocks on parallel threads
  never share scenarios. Scenarios started in the block, or by code it calls on that thread,
  go into it; `scenario` on the receiver also works from other threads. The key is the title
  (with ` #2` added while another block with that title is open), so the file name stays the
  same from run to run.
- Inside the blocks, a lambda only reaches its own receiver: `scenario(...)` inside a
  `scenario { }` does not silently start a sibling in the enclosing report. Name the outer
  receiver when you mean it.

From Java, pass a `Consumer`, or a `Callable` for a value:

```java
ReportFiles files = lsd.report("Online shop", r -> {
    r.scenario("Place an order", s -> s.addFact("orderId", "ord-1001"));
    int rows = r.scenario("Count rows", () -> repository.count());
});
```

### Configuration reference

This table is the complete list of settings. `LsdPropertiesTest` fails when it differs from the
code. Each property is read from the first of these that sets it:

1. a system property: `-Dlsd.mono.report.outputDir=out`;
2. an environment variable, in upper case with dots as underscores:
   `LSD_MONO_REPORT_OUTPUTDIR=out`;
3. with lsd-mono-junit-jupiter, a JUnit configuration parameter, for example in
   `src/test/resources/junit-platform.properties`;
4. `lsd-mono.properties` at the root of the classpath (for example in
   `src/test/resources`), read once;
5. the default below.

`LsdProperties` has a constant for each name. lsd-core's names are not read: coming from
lsd-core, rename `lsd.core.report.outputDir`, `lsd.core.ids.deterministic`,
`lsd.junit.hideStacktrace`, `lsd.core.metrics.enabled` and `lsd.core.label.maxWidth` to the
`lsd.mono.*` names below.

A boolean accepts `true`/`false`, `yes`/`no`, `on`/`off` and `1`/`0`, in any case. Any other
value is logged as a warning (once) and the default is used, so a typo never quietly turns
a feature off.

| Property | Default | Effect |
| --- | --- | --- |
| `lsd.mono.report.outputDir` | `build/reports/lsd` | Directory the reports are written to |
| `lsd.mono.ids.deterministic` | `false` | `true` numbers ids 1, 2, 3… instead of random ones, for reproducible reports |
| `lsd.mono.hideStacktrace` | `false` | `true` leaves the stack trace out of a failed scenario's error (JUnit and Cucumber) |
| `lsd.mono.metrics.enabled` | `true` | Message count and captured duration in the Metrics view |
| `lsd.mono.label.maxWidth` | `200` | Width labels are cut to in summaries and the diagram. Not a positive number: the default |
| `lsd.mono.report.generatedAt` | unset | A fixed ISO-8601 instant written as every report's time, for reproducible reports |
| `lsd.mono.report.usagePing` | `true` | `false` stops the report page requesting the usage ping file from jsDelivr when it is opened, see [Usage ping](../../README.md#usage-ping) |
| `lsd.mono.cucumber.splitBySteps` | `false` | `true` makes the Cucumber plugin start a section at each step |
| `lsd.mono.payload.maxDepth` | `32` | Payload limit, see [Message data](#message-data) |
| `lsd.mono.payload.maxStringLength` | `100000` | Payload limit, see [Message data](#message-data) |
| `lsd.mono.payload.maxItems` | `1000` | Payload limit, see [Message data](#message-data) |
| `lsd.mono.payload.maxTotalSize` | `1000000` | Payload limit, see [Message data](#message-data) |
| `lsd.mono.payload.redact` | `true` | `false` turns off the built-in secret key names, see [Redaction](#redaction) |
| `lsd.mono.payload.redactKeys` | unset | Comma-separated key names to redact as well, see [Redaction](#redaction) |
| `lsd.mono.propagation.allowedHosts` | `localhost,127.0.0.1,::1` | Hosts `scenarioHeaderValue` gives the scenario header for: names, `*.domain` or `*`. See [Interceptors](#interceptors) |
| `lsd.mono.scenario.inheritBinding` | `true` | `false` stops threads inheriting the scenario of the thread that started them, see [Threads](#threads-and-parallel-tests) |
| `lsd.mono.timing.orderByStartedAt` | `source` | Clock ordering of events with a start time but no measured duration: `false`, `source` (same source; also `true`) or `all`. Moved events are marked `order: CLOCK`, see [Timing](#timing) |

Settings made in code rather than by property:

| Setting | Effect |
| --- | --- |
| `LsdContext.configure(Consumer<TimingConfig>)` | `TimingConfig.orderByStartedAt(mode)`: clock ordering for scenarios completed from now on; `null` reads `lsd.mono.timing.orderByStartedAt`. Chains the same from Java and Kotlin |
| `Timing.orderByStartedAt` | Opts one event in or out of clock ordering |
| `LsdContext.payloads` | Payload converters and redaction rules (see [Message data](#message-data)); `clear()` re-reads the payload properties |

The report page remembers a few choices in the reader's browser, not in the report: the theme
(`lsd-report-theme-v2`, local storage), the collapsed scenario list (`lsd-report-sidebar`, local storage) and the side
panel width (`lsd-report-inspector-width`, session storage).

### Threads and parallel tests

Every `LsdContext` method is thread-safe. Unscoped calls (`capture`, `message`,
`addFact`, `addParticipants`, `completeScenario`) go to:

1. the scenario the calling thread is bound to, if any, or else the one it inherited
   (below);
2. otherwise the only running scenario, if exactly one is running;
3. otherwise the default scenario, which is how single-threaded code has always
   worked. With several scenarios running, a warning is logged once.

Participants declared inside a scenario belong to that scenario only, so tests running in
parallel never draw each other's participants, whichever declares first. Declarations made with
no scenario running (for example in a `@BeforeAll`) apply to every scenario. A scenario's own
declaration of the same id takes precedence.

Test integrations start a scenario per test and group them by report key:

```kotlin
val scenario = lsd.beginScenario(reportKey = "com.example.OrderTest") // binds this thread
lsd.message("Client", "Api", "POST /orders")                          // lands in `scenario`
executor.submit(lsd.wrap { lsd.message("Api", "Db", "INSERT") })       // so does this
scenario.complete("places an order")
lsd.completeReport("OrderTest", reportKey = "com.example.OrderTest")
```

`wrap` takes a `Runnable` or a `Callable`. `LsdScenario` also has the verbs,
`capture { }`, `wrap` and `bind()`, which returns an `LsdBinding`: an `AutoCloseable` whose
`close()` throws nothing, so Java's try-with-resources needs no `catch`.
A capture into a scenario that has already completed is dropped
with a warning rather than being given to the next one.

A thread started by a bound thread inherits its scenario, so `thread { lsd.message(...) }`
or a virtual thread from `Executors.newVirtualThreadPerTaskExecutor()` in a test captures into
that test's scenario. An inherited binding is weaker than one made on the thread itself:

- It counts only while that scenario is running. A thread that outlives its test goes back
  to the rules above, and the scenario is not kept in memory by it.
- Pool and executor worker threads never use it: `ThreadPoolExecutor` (and the `Executors`
  factories built on it), `ForkJoinPool` (the common pool, parallel streams and
  `CompletableFuture`'s default executor), the kotlinx.coroutines dispatchers, Netty event loops
  and Jetty's thread pool. A pool thread is created by whichever task first needs it and is then
  reused for unrelated work, possibly from other tests running in parallel, so inheriting there
  would put captures in the wrong scenario. Use `wrap` or `bind()` for executors.
- `lsd.mono.scenario.inheritBinding=false` turns inheritance off.

`completeReport` completes any scenarios for that report that are still running, so a forgotten
`complete` cannot leave one out of the report or let it attract later unbound captures. Each one
is written with status `WARN`, its key as the title, the events captured so far, and the
description "Scenario was not completed before the report was written", which the report shows
under the scenario. A warning naming them is also logged. Completing such a scenario afterwards
does nothing. Discard a scenario you do not want in the report before calling `completeReport`.

The binding belongs to a thread, so it does not follow a coroutine that resumes on another
dispatcher thread. In Kotlin coroutines use `withLsdScenario` from
[`lsd-mono-coroutines`](../lsd-mono-coroutines/README.md), or capture through the
`LsdScenario` reference.

### Message data

Message data is copied when it is captured, so changing a body, builder or buffer
after the call does not change the report. The copy is plain JSON:

- maps become objects (keys that are not strings use their text, and a repeated
  key gets ` #2`); iterables and arrays become lists;
- Kotlin data classes, Java records and other classes become objects of their fields;
- `Optional` becomes its value or `null`, enums their name, and `java.time` values,
  `Date`, `UUID` and similar types their ISO or plain text;
- `ByteArray` and `ByteBuffer` become text when they are UTF-8 text, otherwise
  `[lsd: binary, N bytes] base64:...`. Only the first `maxStringLength * 4` bytes are read (cut
  on a UTF-8 character boundary), so a large upload is never decoded or encoded whole;
- a `Throwable` becomes `{"exception": ..., "message": ...}`.

Capturing never throws. Anything that cannot be copied becomes a `[lsd: ...]`
marker in its place: a cycle, a `toString()` or accessor that throws, or a value
past one of these limits (defaults in the [configuration reference](#configuration-reference)):

| Limit | Marker |
| --- | --- |
| `lsd.mono.payload.maxDepth` |
| `lsd.mono.payload.maxStringLength` |
| `lsd.mono.payload.maxItems` |
| `lsd.mono.payload.maxTotalSize` |

To copy a type differently (a JSON tree, say), register a converter. Its result
is copied in turn:

```kotlin
lsd.payloads.register<JsonNode> { mapper.convertValue(it, Map::class.java) }
```

```java
lsd.getPayloads().register(JsonNode.class, node -> mapper.convertValue(node, Map.class));
```

Later registrations win; `lsd.payloads.clear()` removes them all. The limits are set
only by the properties above; `lsd.clear()` re-reads them and keeps the converters.

#### Redaction

A value whose key looks like a secret is written as `[lsd: redacted]`, on by default.
The key is a map key (header maps included), an object field or a record component, and
the whole value under it is dropped, however deep. Keys are compared ignoring case and
`-`, `_`, `.` and spaces, and match a name when they equal it or end with it. The built-in
names are:

`password`, `passwd`, `secret`, `token`, `authorization`, `apiKey`, `api_key`, `cookie`, `set-cookie`

So `accessToken`, `refresh_token`, `X-Api-Key`, `client_secret` and `Set-Cookie` are
redacted, while `tokenType` and `passwordPolicy` are not.

Set `lsd.mono.payload.redact=false` to turn off the built-in names, and
`lsd.mono.payload.redactKeys=ssn,x-session` to add names. In code:

```kotlin
lsd.payloads.redact("ssn", "pin")
lsd.payloads.redactWhen { key -> key.startsWith("x-internal-") }
```

```java
lsd.getPayloads().redact("ssn", "pin");
lsd.getPayloads().redactWhen(key -> key.startsWith("x-internal-"));
```

A `redactWhen` rule sees the key as captured, and a rule that throws redacts.
`lsd.payloads.clearRedaction()` removes the rules added in code; `lsd.clear()` re-reads
the properties and keeps them.

Only keys are checked, never free text. A raw JSON body held as a `String` is not
searched: register a converter that parses it into a map so its keys are checked. The
`message` of `PendingCall.fail(error)` is kept as it is, because exception messages are
free text and rarely hold secrets under a recognisable key. Add
`redactWhen { it == "message" }` if yours might.

### Escaping

Report text is plain data and is escaped wherever it is written, with one escaper
per context:

| Context | Kotlin (written files) | Report UI (`report/src/lib/escape.ts`) |
| --- | --- | --- |
| Element text | `Html.text` | `escapeHtml` |
| Quoted attribute value | `Html.attribute` | `escapeAttr` |
| JSON in `<script>` or a `.js` file | `jsonString` / `JsonValue.render()` | `jsonForScript` |
| CSS selector | | `cssEscape` |

JSON for scripts escapes `<`, `>`, `&`, U+2028, U+2029 and control characters, and
writes a lone surrogate as `\ufffd`. The Kotlin HTML escapers also replace control
characters and lone surrogates with U+FFFD, because the files are UTF-8. A scenario
description that contains `<mark>` keeps only bare `p`, `br`, `mark`, `strong`, `em`,
`b`, `i` and `code` tags; anything else in it is shown as text.

## Report UI (manual)

```bash
cd modules/lsd-mono-core/report
npm ci
npm test             # vitest — layout, diagram view (zoom/fit/columns/search), SVG cues
npm run dev          # http://localhost:5173/
npm run build:single # then open report/dist/lsd-report.html in Chrome (file://)
```

`./gradlew :modules:lsd-mono-core:build` runs `reportSingle` (`npm ci` and `npm run build:single`) and `reportTest` (`npm test`). `build:single` writes `report/dist/lsd-report.html` (gitignored), and the build packages it from `build/generated/resources`; no built shell is committed. Set `lsd.mono.report.generatedAt` (an ISO-8601 instant) to fix the report's "generated at" time, as the sample tasks do for reproducible output. Needs Node 22.6 or later (`engines` in `report/package.json`). The Gradle tasks prepend the nvm Node named in the repo's `.nvmrc` (CI's Node) when it is installed, else the newest nvm Node of at least 22.6 (`build-logic` `NodeToolchain.kt`), and do not change your default Node.

See `report/README.md` for how to run the report UI.
