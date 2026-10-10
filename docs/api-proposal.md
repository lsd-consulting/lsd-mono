# lsd-mono public API proposal (#3)

Status: approved. Slices 1 to 5 are implemented (see "as built" under §6); later slices are not. Audited at `main` = `5fe9520`, so §1 describes the surface before slice 1.
Scope: `lsd-mono-core`, `lsd-mono-junit-jupiter`, `lsd-mono-cucumber-8`.
Ground rules: greenfield and unpublished, so no deprecation shims and no `com.lsd.core` compatibility. Kotlin-first, but it must stay usable from Java.

Includes the REVIEW.md items folded into #3: `explicitApi()` and an ABI validator, `createdAt` missing from some builders, the `""` phantom-edge sentinel, `open LsdContext`, and the legacy property keys being kept in two places.

---

## 1. Current public surface

About 70 top-level public declarations. Nothing is `internal` except a few helpers, because explicit API mode is off.

Legend: **U** = unused outside its own file or tests. **L** = mirrors legacy lsd-core. **B** = Java-shaped builder. **P** = bag of optional parameters. **X** = implementation detail that leaks out.

### Entry points (`io.lsdconsulting.lsd.mono.core`)

| Type | Public members | Flags |
|---|---|---|
| `open class LsdContext` | `instance` (`@JvmStatic`), public constructor, `idGenerator`, `payloads`, `outputDirectory` | `open` but only `capture` is open (**X**); `idGenerator` is **X**; `outputDirectory` is **X/U** |
| | `addParticipants(vararg)`, `addParticipants(List)`, `addFact(key, value="")` | **L** |
| | `capture(vararg SequenceEvent)`, `capture(vararg SequenceEventBuilder)` | two capture paths (**L**) |
| | `message(from,to,label,type,data,colour,durationMs)` | **P**: from Java, `data` can't be passed without `type` |
| | `response(...)`, `note(text, over)`, `noteLeft(text, of?)`, `noteRight(text, of?)`, `divider`, `section`, `delay`, `spacer`, `shortInbound`, `shortOutbound`, `activate(p, colour?)`, `deactivate` | duplicated as top-level DSL builders (see below); none takes `createdAt` |
| | `beginScenario(reportKey?, key=uuid, bindCurrentThread=true)`, `currentScenario()`, `findScenario(key)`, `wrap(Runnable)` | needed by integrations; **P** |
| | `completeScenario(title, description: String? = "", status, error?)` | **P**, **L**; nullable description with a `""` default |
| | `completeReport(title, reportKey?) : Path`, `createIndex() : Path`, `clear()` | keep |
| | `clearScenarioEvents()` | **U**, **L** |
| `class LsdScenario` (internal constructor) | `key`, `reportKey`, `isActive`, `capture(vararg …)` x2, `addFact`, `bind(): AutoCloseable`, `wrap(Runnable)`, `wrapCallable(Callable)`, `complete(...)`, `discard()` | `wrapCallable` **U**; `complete` **P** |
| `class IdGenerator` | `next()`, `reset()` | **X** (it's in the `SequenceEventBuilder` signature) |
| `data class ReportOptions` + `fromProperties()`, `DEFAULT_LABEL_MAX_WIDTH` | | **X**: nothing accepts it |
| `fun String.abbreviate(maxWidth)` | | **X**, and it adds an extension to every `String` in the caller's project |

### Capture DSL (`core.capture.CaptureDsl.kt`)

| Declaration | Flags |
|---|---|
| `fun interface SequenceEventBuilder { build(IdGenerator) }` | **L**, **X** |
| `class MessageBuilder` (`id/from/to/label/data/colour/type/durationMs`) + `messageBuilder()` | **B**, **L**; no `createdAt`; `messageBuilder()` **U** |
| `String/Participant messages String/Participant` (4 overloads); `withLabel`, `withData`, `withType`, `withColour`, `withDurationMs` | keep the idea, but it's not committed until passed to `capture(...)` |
| `class LifelineBuilder` + `LifelineAction lifeline p` + `withColour` | **B**, **L**; has `createdAt`, unlike `MessageBuilder` |
| `noteOver`, `noteLeft`, `noteRight`, `logicalDivider`, `section`, `delay`, `spacer`, `shortInbound`, `shortOutbound` (with Participant overloads) | each duplicates an `LsdContext` method; `logicalDivider` is **L** (same as `divider`) |

### Domain (`core.domain`)

| Type | Flags |
|---|---|
| `sealed class SequenceEvent` + `Message`, `Note`, `Divider`, `Section`, `Delay`, `Spacer`, `Lifeline` (public data classes, each with a required `id`) | **X**: callers have to invent ids (`Section(id = "", …)` in Cucumber); `Message.from/to = ""` is a sentinel |
| `enum MessageType` (7), `NotePlacement`, `LifelineAction` | keep `MessageType`; `LifelineAction` is **L** |
| `data class Participant(name, id, type, alias, colour)`, `enum ParticipantType` + `called(...)`, `object ParticipantIds` | `alias` is really the display name; `ParticipantIds` **X** |
| `data class Fact`, `data class Scenario` | **X** (storage) |
| `data class ScenarioError(headline, message, stack?)` | keep |
| `enum Status { ERROR, FAILURE, SUCCESS }` + `toReportStatus()`, `toCssClass()` | `FAILURE` shows as "Warn" in the UI (**L**); both methods **X** |
| `fun orderByCreatedAt(...)` | **X** |

### Report, model, properties, payloads, html

| Declaration | Flags |
|---|---|
| `object ReportWriter`: `reportFileStem`, `writeReport(ReportJson, dir, key?)`, `writeIndex(files, dir)` | **X**: `completeReport` and `createIndex` already cover this |
| `model/*`: `ReportJson`, `ScenarioJson`, the 7 `*EventJson` types, `ReportFile`, `ShellReport`, `forShell()`, `toJson()`, `shellPayloadScript()`, … (about 20) | **X**: this is the wire format, not an API |
| `capturedMetrics`, `CapturedMetrics`, `MAX_INSIGHTS` | **X** |
| `object PopupContent.popupHyperlink(...)` | **U**, **L** ("migration shim only", per `porting-gap.md`) |
| `object Html` (`text`, `attribute`, `wellFormed`) | **X** (#28 escaper; integrations don't need it) |
| `object LsdProperties`: 6 key constants, `get`, `getBoolean` (x2 each), 6 typed readers | legacy keys live in `defaults` and again in each `resolveWithLegacy` call; generic `get`/`getBoolean` **X** |
| `class PayloadSnapshot` (`var limits`, `register(Class, Function)`, `clearConverters()`, `snapshot()`), nested `Limits` + 4 key constants | `register` is the only member users need; `snapshot` and `limits` are **X** |

### Integrations

| Module | Public | Flags |
|---|---|---|
| junit-jupiter | `class LsdExtension` (5 callback overrides), `annotation LsdPostTestProcessing` (FUNCTION, PROPERTY_GETTER, PROPERTY_SETTER) | `@LsdPostTestProcessing` is **L**: capture in `@AfterEach` already lands in the test's scenario |
| cucumber-8 | `class LsdCucumberPlugin` + `SPLIT_BY_STEPS` constant | the key sits outside `LsdProperties`; it constructs a `Section(id = "")` directly |

What the integrations import from core: `LsdContext`, `LsdScenario`, `ScenarioError`, `Status`, `Section`, `LsdProperties` (`hideStacktrace`, `getBoolean`), plus the DSL in tests. Both integrations have their own copy of the stack-trace and `hideStacktrace` code.

---

## 2. Remove or make internal

| Item | Action | Why |
|---|---|---|
| `model/*`, `ReportWriter`, `Bottlenecks`, `ReportOptions`, `orderByCreatedAt`, `IdGenerator`, `ParticipantIds`, `Fact`, `Scenario`, `abbreviate`, `Html`, `LsdVersion` | `internal` | Wire format and implementation. Only same-module tests use them, and internal still works there. |
| `SequenceEvent` + the 7 event classes, `NotePlacement`, `LifelineAction` | `internal` | Callers use verbs instead. Ids are always assigned by the context, and from/to become nullable inside (fixes the `""` sentinel). The JSON still writes `""`, so the UI doesn't change. |
| `SequenceEventBuilder`, `MessageBuilder`, `LifelineBuilder`, `messageBuilder()`, the top-level `noteOver/noteLeft/noteRight/logicalDivider/section/delay/spacer/shortInbound/shortOutbound` builders | **remove** | Replaced by the verbs and the `capture { }` block (§3, §4). Two capture paths become one. |
| `LsdContext.capture(vararg SequenceEvent)` / `(vararg SequenceEventBuilder)` | **remove** | Replaced by `capture { }`. |
| `LsdContext.clearScenarioEvents()`, `PopupContent`, `LsdScenario.wrapCallable` | **remove** | Unused or legacy. `wrap(Callable)` becomes an overload. |
| `LsdContext.idGenerator`, `outputDirectory`; `open` on the class and on `capture` | `internal` / make final | Nothing should subclass it; separate instances are the extension point. |
| `Status.toReportStatus/toCssClass` | `internal` | Only the report uses them. |
| `Status.FAILURE` | rename to `WARN` (optional) | Matches the UI's Success, Warn and Error filters. The JSON strings don't change. |
| `Participant.alias` | rename to `displayName` | `name` is the reference and `alias` is what's drawn, which is backwards to how it reads. |
| `LsdProperties` generic `get/getBoolean` and the typed readers | `internal` behind one alias table; integration readers `@InternalLsdApi` | Fixes the "legacy keys in two places" review item. Public: key constants only. |
| `LsdCucumberPlugin.SPLIT_BY_STEPS` | move to `LsdProperties.CUCUMBER_SPLIT_BY_STEPS` | One place for every key. |
| `PayloadSnapshot` | rename to `PayloadConverters`; keep `register` (+ reified), `clear()`; make `snapshot`, `limits` and `Limits` internal (limits come from properties) | Users only register converters. |
| `@LsdPostTestProcessing` | remove (or narrow its target to FUNCTION only) | `@AfterEach` already captures into the test. Only keep it if someone needs "before `@AfterEach` teardown" ordering. |

Proposed internal key table (one place):

```kotlin
internal enum class LsdKey(val key: String, val legacy: String?, val default: String?) {
    OUTPUT_DIR("lsd.mono.report.outputDir", "lsd.core.report.outputDir", "build/reports/lsd"),
    DETERMINISTIC_IDS("lsd.mono.ids.deterministic", "lsd.core.ids.deterministic", "false"),
    HIDE_STACKTRACE("lsd.mono.junit.hideStacktrace", "lsd.junit.hideStacktrace", "false"),
    METRICS_ENABLED("lsd.mono.metrics.enabled", "lsd.core.metrics.enabled", "true"),
    LABEL_MAX_WIDTH("lsd.mono.label.maxWidth", "lsd.core.label.maxWidth", "200"),
    GENERATED_AT("lsd.mono.report.generatedAt", null, null),
    CUCUMBER_SPLIT_BY_STEPS("lsd.mono.cucumber.splitBySteps", null, "false"),
    // lsd.mono.payload.* likewise
}
```

---

## 3. Proposed Kotlin API

### 3.1 Shape

```kotlin
package io.lsdconsulting.lsd.mono.core

/** Verbs shared by the context (current scenario), a scenario, and a capture block. Not subclassable. */
public sealed class Capturer {
    @JvmOverloads public fun message(from: String, to: String, label: String = "", data: Any? = null,
        type: MessageType = MessageType.SYNCHRONOUS, durationMs: Long? = null, colour: String? = null, at: Instant? = null)
    @JvmOverloads public fun response(from: String, to: String, label: String = "", data: Any? = null,
        durationMs: Long? = null, at: Instant? = null)
    @JvmOverloads public fun async(from: String, to: String, label: String = "", data: Any? = null, at: Instant? = null)
    /** Sync request now; the returned handle writes the response, timed, into the same scenario. */
    @JvmOverloads public fun call(from: String, to: String, label: String = "", data: Any? = null, at: Instant? = null): PendingCall
    @JvmOverloads public fun inbound(to: String, label: String = "", at: Instant? = null)   // was shortInbound
    @JvmOverloads public fun outbound(from: String, label: String = "", at: Instant? = null) // was shortOutbound
    @JvmOverloads public fun note(text: String, on: String? = null, side: NoteSide = NoteSide.OVER, at: Instant? = null)
    @JvmOverloads public fun activate(participant: String, colour: String? = null, at: Instant? = null)
    @JvmOverloads public fun deactivate(participant: String, at: Instant? = null)
    @JvmOverloads public fun section(title: String, at: Instant? = null)
    @JvmOverloads public fun divider(label: String, at: Instant? = null)
    @JvmOverloads public fun delay(label: String? = null, at: Instant? = null)
    @JvmOverloads public fun spacer(heightPx: Int? = null, at: Instant? = null)
    @JvmOverloads public fun addFact(key: String, value: String = "")
    internal abstract fun emit(events: List<SequenceEvent>)   // sealed: only the three classes below
}

public class LsdContext : Capturer() {            // final; capture goes to the current scenario (#24 rules)
    public companion object { @JvmStatic public val instance: LsdContext }
    public val payloads: PayloadConverters
    public fun addParticipants(vararg participants: Participant)
    public fun capture(block: CaptureBlock.() -> Unit)                        // Kotlin
    public fun capture(block: Consumer<CaptureBlock>)                         // Java (@JvmSynthetic on the Kotlin form)
    public fun <T> scenario(title: String, description: String = "", reportKey: String? = null,
                            block: LsdScenario.() -> T): T                    // §4
    public fun <T> report(title: String, block: LsdReport.() -> T): Path      // §4
    @JvmOverloads public fun beginScenario(reportKey: String? = null, key: String = uuid(), bindCurrentThread: Boolean = true): LsdScenario
    public fun currentScenario(): LsdScenario?
    public fun findScenario(key: String): LsdScenario?
    public fun wrap(task: Runnable): Runnable
    public fun <T> wrap(task: Callable<T>): Callable<T>
    @JvmOverloads public fun completeScenario(title: String, description: String = "", status: Status = Status.SUCCESS, error: ScenarioError? = null)
    @JvmOverloads public fun completeReport(title: String, reportKey: String? = null): Path
    public fun createIndex(): Path
    public fun clear()
}

public class LsdScenario internal constructor(...) : Capturer() {
    public val key: String; public val reportKey: String?; public val isActive: Boolean
    public fun capture(block: CaptureBlock.() -> Unit) / capture(Consumer<CaptureBlock>)
    public fun bind(): AutoCloseable
    public fun wrap(task: Runnable): Runnable;  public fun <T> wrap(task: Callable<T>): Callable<T>
    @JvmOverloads public fun complete(title: String, description: String = "", status: Status = Status.SUCCESS, error: ScenarioError? = null)
    public fun discard()
}

public class PendingCall internal constructor(...) {      // thread-safe, first reply wins
    @JvmOverloads public fun reply(label: String = "", data: Any? = null, at: Instant? = null)
    public fun fail(error: Throwable)                      // response labelled with the exception, data = {exception, message}
}

public data class ScenarioError(val headline: String, val message: String, val stack: String? = null) {
    public companion object { @JvmStatic public fun of(headline: String, cause: Throwable?): ScenarioError } // honours hideStacktrace; dedupes JUnit and Cucumber
}
public enum class NoteSide { OVER, LEFT, RIGHT }
```

Java notes:
- `Capturer` is an abstract **class**, not an interface, because `@JvmOverloads` is not allowed on interface members.
- Parameter order is `from, to, label, data` first, so the Java overloads that `@JvmOverloads` generates cover the common calls.
- Add `@file:JvmName("Lsd")` to the top-level DSL file, so Java sees `Lsd.lsd(...)` rather than `CaptureKt`.
- Lambda-taking functions get a `java.util.function.Consumer` or `Function` overload. The Kotlin form is `@JvmSynthetic`, so Java doesn't see a `Function1` that returns `Unit`.
- Add `@JvmStatic` to companion members (`instance`, `ScenarioError.of`).

### 3.2 HTTP client interceptor (request and response)

Before (current main):
```kotlin
class LsdHttpInterceptor(private val lsd: LsdContext = LsdContext.instance) : ClientHttpRequestInterceptor {
    override fun intercept(req: HttpRequest, body: ByteArray, exec: ClientHttpRequestExecution): ClientHttpResponse {
        val path = "${req.method} ${req.uri.path}"
        lsd.capture("Test" messages "Orders" withLabel path withData mapOf("headers" to req.headers, "body" to body))
        val start = System.nanoTime()
        val res = exec.execute(req, body)
        lsd.response("Orders", "Test", res.statusCode.toString(),
            data = mapOf("headers" to res.headers), durationMs = (System.nanoTime() - start) / 1_000_000)
        return res
    }
}
```
After:
```kotlin
class LsdHttpInterceptor(private val lsd: LsdContext = LsdContext.instance) : ClientHttpRequestInterceptor {
    override fun intercept(req: HttpRequest, body: ByteArray, exec: ClientHttpRequestExecution): ClientHttpResponse {
        val call = lsd.call("Test", "Orders", "${req.method} ${req.uri.path}", data = mapOf("headers" to req.headers, "body" to body))
        val res = try { exec.execute(req, body) } catch (e: IOException) { call.fail(e); throw e }
        call.reply(res.statusCode.toString(), data = mapOf("headers" to res.headers))   // duration measured, from/to reversed
        return res
    }
}
```
`PendingCall` holds the scenario it was created in. With an async client (WebClient, OkHttp `enqueue`), the reply can arrive on an unbound thread and still lands in the right test. Today it falls back to the "only running scenario, else default + warning" rule.

### 3.3 Kafka consumer

Before:
```kotlin
class LsdConsumerInterceptor : ConsumerInterceptor<String, String> {
    override fun onConsume(records: ConsumerRecords<String, String>): ConsumerRecords<String, String> {
        records.forEach { r ->
            LsdContext.instance.capture(r.topic() messages "Orders" withLabel "consume ${r.key()}" withType MessageType.ASYNCHRONOUS withData r.value())
        }   // poll thread is unbound: with parallel tests this goes to the default scenario + warning
        return records
    }
}
```
After (the producer interceptor stamps the scenario key; the consumer routes by it):
```kotlin
// producer side
override fun onSend(r: ProducerRecord<String, String>) = r.also { rec ->
    lsd.currentScenario()?.let { rec.headers().add(LsdHeaders.SCENARIO, it.key.toByteArray()) }
    lsd.async("Orders", rec.topic(), "publish ${rec.key()}", data = rec.value())
}
// consumer side
override fun onConsume(records: ConsumerRecords<String, String>) = records.also {
    it.forEach { r ->
        val target: Capturer = r.headers().lastHeader(LsdHeaders.SCENARIO)
            ?.let { h -> lsd.findScenario(String(h.value())) } ?: lsd
        target.async(r.topic(), "Orders", "consume ${r.key()}", data = r.value(), at = Instant.ofEpochMilli(r.timestamp()))
    }
}
```
`LsdHeaders.SCENARIO = "lsd-scenario"` is a public constant name for correlation headers, for HTTP too. `at` puts out-of-order consumption back in time order.

### 3.4 Test adding facts and notes

Before:
```kotlin
@ExtendWith(LsdExtension::class)
class PlaceOrderTest {
    private val lsd = LsdContext.instance
    @Test fun `places an order`() {
        lsd.addFact("orderId", "ord-1001")
        lsd.capture("Customer" messages "Checkout" withLabel "POST /orders" withData body)
        lsd.noteRight("SOCKS10 takes 10% off", of = "Checkout")
        lsd.capture(noteOver("Orders", "row saved"))
    }
}
```
After (JUnit injects the test's own scenario; no singleton, so it's right even under `@Timeout` threads):
```kotlin
@ExtendWith(LsdExtension::class)
class PlaceOrderTest {
    @Test fun `places an order`(lsd: LsdScenario) {
        lsd.addFact("orderId", "ord-1001")
        lsd.capture {
            "Customer" calls "Checkout" label "POST /orders" data body
            note("SOCKS10 takes 10% off", on = "Checkout", side = RIGHT)
            note("row saved", on = "Orders")
        }
    }
}
```
`LsdExtension` adds a `ParameterResolver` for `LsdScenario`. `LsdContext.instance` keeps working for code that has no parameter, such as interceptors.

### 3.5 Java

Before:
```java
LsdContext lsd = LsdContext.getInstance();
lsd.capture(MessageBuilder.messageBuilder().from("Client").to("Orders").label("POST /orders").data(body));
lsd.response("Orders", "Client", "201", null, 42L);
lsd.noteRight("applied", "Orders");
```
After:
```java
LsdContext lsd = LsdContext.getInstance();
PendingCall call = lsd.call("Client", "Orders", "POST /orders", body);
call.reply("201 Created", responseBody);
lsd.note("applied", "Orders", NoteSide.RIGHT);
lsd.capture(c -> { c.async("Orders", "order-events", "order.paid", event); c.activate("Orders"); });
lsd.getPayloads().register(JsonNode.class, n -> mapper.convertValue(n, Map.class));
```
Add a small `src/test/java` API test that compiles against these shapes, so Java usability can't regress.

---

## 4. Capture DSL

```kotlin
@DslMarker internal annotation class LsdDsl

@LsdDsl
public class CaptureBlock internal constructor(...) : Capturer() {
    public infix fun String.calls(to: String): MessageSpec       // SYNCHRONOUS
    public infix fun String.repliesTo(to: String): MessageSpec   // SYNCHRONOUS_RESPONSE
    public infix fun String.sends(to: String): MessageSpec       // ASYNCHRONOUS
    public infix fun MessageSpec.label(text: String): MessageSpec
    public infix fun MessageSpec.data(value: Any?): MessageSpec
    public infix fun MessageSpec.took(ms: Long): MessageSpec
    public infix fun MessageSpec.colour(css: String): MessageSpec
    public infix fun MessageSpec.at(instant: Instant): MessageSpec
}

/** Shorthand for LsdContext.instance.capture { }. */
public fun lsd(block: CaptureBlock.() -> Unit): Unit
```

```kotlin
lsd {
    "Customer" calls "Orders" label "POST /orders" data body took 412
    activate("Orders")
    "Orders" sends "order-events" label "order.paid"
    note("idempotent by orderId", on = "Orders")
    "Orders" repliesTo "Customer" label "201 Created"
    deactivate("Orders")
}
```

Scoped scenarios and reports, for samples, `main()` programs and other test frameworks:

```kotlin
val path = LsdContext().report("Online shop") {
    scenario("Place an order", description = "Given … When … Then …") {
        addFact("orderId", "ord-1001")
        capture { "Customer" calls "Web Shop" label "click Place order" }
        placeOrder()            // real code; its interceptors capture into this scenario
    }                           // SUCCESS; an exception completes it as ERROR with ScenarioError.of(...) and is rethrown
    scenario("Card declined") { … }
}                               // completeReport(title, its own reportKey) + createIndex()
```

### Thread-safety, given the #24 per-scenario design

| Construct | Behaviour |
|---|---|
| `capture { }` | Resolves its target **once**, at block start: the bound scenario, else the only running one, else the default scenario with the existing one-time warning. Specs collect into a local list and are appended under the scenario's lock **in one go** at block end, so a block's events stay together and can't straddle two scenarios. The block receiver must not leak to other threads (documented; `@LsdDsl` stops accidental calls to an outer scope). |
| Infix specs | Only valid inside a `CaptureBlock`, because they're committed at block end. That removes today's trap, where `"A" messages "B"` is built but never passed to `capture`. |
| Direct verbs on `LsdContext` / `LsdScenario` | One event, appended immediately; same target rules as today. |
| `scenario { }` | `beginScenario(reportKey, key = uuid)` binds the thread. The body runs, then `try/finally` completes the scenario and **restores the previous binding** (as `bind()` does now). Parallel `scenario {}` calls on different threads are independent. A nested `scenario {}` on the same thread is allowed; the inner one shadows the outer until it ends. |
| `report { }` | Generates a unique `reportKey`, so parallel `report {}` blocks never mix scenarios. `scenario` inside `report` inherits that key. |
| `PendingCall` | Holds its scenario, so `reply` from any thread lands correctly. Only the first `reply` or `fail` counts. A reply after the scenario completed is dropped with the existing "late capture" warning. |
| Executors | `wrap(Runnable)` / `wrap(Callable)`, as today. |
| Coroutines | A `ThreadLocal` binding is lost when a coroutine suspends. Later, an optional `lsd-mono-coroutines` module could add `scenario.asContextElement()` (a `ThreadContextElement`). Until then, capture through the `LsdScenario` reference, which doesn't depend on the thread. |

---

## 5. Explicit API + ABI validation

In `build-logic/src/main/kotlin/lsd.kotlin-jvm.gradle.kts` (all three modules):

```kotlin
kotlin {
    explicitApi()                       // public things need an explicit `public` and a return type
    @OptIn(org.jetbrains.kotlin.gradle.dsl.abi.ExperimentalAbiValidation::class)
    abiValidation {
        filters { exclude { annotatedWith.add("io.lsdconsulting.lsd.mono.core.InternalLsdApi") } }
    }
}
```

- **Built-in KGP ABI validation, not the kotlinx plugin.** The repo is on Kotlin 2.4.21, and Kotlin 2.4 has `abiValidation` built in. It adds `checkKotlinAbi` to `check` and `updateKotlinAbi` to refresh the dumps. The kotlinx binary-compatibility-validator README itself now recommends the built-in one, and it's one less plugin for Renovate to track.
- The DSL is still `@ExperimentalAbiValidation`. Kotlin 2.4.0 already changed it, so a future Renovate Kotlin bump may need a one-line fix. Keeping it in the single convention plugin keeps that small.
- **Dumps:** commit the reference `.api` files that `updateKotlinAbi` writes. Add them to `docs/generated-files.md`. Leave them out of `verifyGenerated`, because `checkKotlinAbi` already fails CI when they drift.
- **Integration-only API:** `@RequiresOptIn(level = ERROR) public annotation class InternalLsdApi` covers integration-only API, such as `LsdProperties` readers or anything an integration needs that users shouldn't call. The integrations opt in module-wide with `-opt-in=…InternalLsdApi`.
- **Readme source set:** if explicit API mode applies to the `readme` source set, disable it there with `-Xexplicit-api=disable` on `compileReadmeKotlin`. Tests are exempt by default.
- **Publishing (#31):** the dumps become the review artefact for "did this PR change the public API?". After the first release, treat any ABI diff as a version decision under `versioning-notes.md`.

---

## 6. Slice order

| # | Slice | Behaviour change | Safety net |
|---|---|---|---|
| 1 | `explicitApi()` + make everything in §2 "internal" internal, delete the **U** items, `LsdContext` final. Enable `abiValidation`, commit the first dumps. | none | build, all tests, sample reports byte-identical (fixed `generatedAt`), `verifyGenerated` |
| 2 | `LsdKey` alias table, `@InternalLsdApi`, `ScenarioError.of`, `SPLIT_BY_STEPS` moved; JUnit and Cucumber use them | none | property tests incl. legacy keys |
| 3 | `Capturer` base + verbs with `at`, nullable phantom ends inside, events internal, ids always generated, `Participant.displayName`, optional `Status.WARN`. Cucumber uses `scenario.section(...)`. Add the Java API test. | API only | golden JSON tests unchanged; Java test compiles |
| 4 | `CaptureBlock` + infix DSL + `lsd {}`; remove `MessageBuilder`, `LifelineBuilder`, `SequenceEventBuilder` and the top-level builders. Migrate the samples and the three READMEs. | API only | samples regenerate identical JSON, so no GIF or screenshot retakes |
| 5 | `call()` / `PendingCall` | new | unit tests incl. cross-thread reply, late reply, double reply |
| 6 | `scenario {}` / `report {}` + JUnit `ParameterResolver`; decide on `@LsdPostTestProcessing` | new | parallel tests from #24 extended to scoped blocks |
| 7 | `PayloadConverters` rename + reified `register<T>`; limits property-only | API only | #27 tests |
| 8 | Review the final `.api` dumps line by line, then hand over to #31 | none | `checkKotlinAbi` |

Slices 1 and 2 are mechanical and safe, so do them first: they shrink the surface before any design choices. Slices 3 and 4 are the bulk of the README and sample churn.

### Slice 1 as built

- `explicitApi()` and `abiValidation()` are in the `lsd.kotlin-jvm` convention. `check` already depends on `checkKotlinAbi`, so nothing extra is wired. The dumps are `modules/<module>/api/<module>.api`.
- The `readme` source set needed no `-Xexplicit-api=disable`: explicit API mode only checks the main compilation.
- `@InternalLsdApi` is not added yet. After the internal pass the integrations use only public API, so nothing needed it; it arrives with slice 2, which needs it for the integration readers. The `abiValidation` exclusion filter comes with it.
- `IdGenerator` is internal. `SequenceEventBuilder` was a `fun interface` whose `build(IdGenerator)` exposed it, so until slice 4 removes the builders it is an `abstract class` with an `internal` constructor and an `internal` `build`. Callers still pass builders to `capture` from Kotlin and Java; only outside implementations (there were none) are no longer possible. The builders' `build` overrides return `SequenceEvent` so no synthetic bridge mentions `IdGenerator` in the dump.
- `LsdScenario.clearEvents` went with `clearScenarioEvents`, its only caller.

### Slice 2 as built

- `LsdKey` is the internal table from §2, with the four `lsd.mono.payload.*` keys added. Each row takes its key string from the matching public `LsdProperties` constant, so every name is written once. The values are read in the same order as before: system property, then environment variable, then the legacy name the same two ways, then the default.
- **All key constants are now on `LsdProperties`**, not just Cucumber's. `PayloadSnapshot.Limits.MAX_*` became `LsdProperties.PAYLOAD_MAX_*`. `Limits`' defaults come from the table, and `Limits` itself stays public until slice 7.
- **The generic `get` and `getBoolean` were removed, not made internal.** Once the typed readers read from `LsdKey`, nothing used them. The typed readers are internal.
- **There's only one `@InternalLsdApi` reader, `LsdProperties.cucumberSplitBySteps()`.** `hideStacktrace()` is read inside `ScenarioError.of` in core, so JUnit uses no internal API and doesn't opt in. Only `lsd-mono-cucumber-8` opts in, with `optIn.add(...)` in its build file. The annotation's `@RequiresOptIn` is at level `ERROR`. The `abiValidation` filter uses `exclude { annotatedWith }`, which is the Kotlin 2.4 name; the Kotlin docs still show the deprecated `excluded`. Members marked `@InternalLsdApi` are left out of the dump, but the annotation class itself is listed.
- `ScenarioError.of(headline, cause)` is `@JvmStatic`. It keeps the old note text when there is no cause or stack traces are hidden. The property is still `lsd.mono.junit.hideStacktrace` and still covers Cucumber too. Renaming it was out of scope.
- **Parsing quirk kept:** `lsd.mono.label.maxWidth` is not trimmed before parsing, but the payload limits are. I kept that difference so slice 2 doesn't change behaviour.
- **One documented table:** the core README "Properties" section lists every key with its legacy name, default and effect, and the other READMEs link to it. `LsdPropertiesTest` fails if the README table and `LsdKey` differ, and it covers the legacy fallback of every key.

### Slice 3 as built

- **Both flagged risks hold up, so the shape didn't change.** A throwaway probe (Kotlin 2.4.21, JDK 21) confirmed:
  - `@JvmOverloads` on the final members of a `sealed class` generates the 2- to 5-argument overloads, and Java calls them.
  - `capture(block: Function1)` marked `@JvmSynthetic`, `capture(Consumer)` and `capture(vararg …)` have distinct JVM signatures and don't clash.
  - In Kotlin, `capture { }` picks the lambda form, and `capture()` or `capture("a", "b")` pick the vararg form.
  - A Java lambda resolves to `Consumer`, and Java can't see the synthetic form.
- `Capturer` is a `sealed class` with `LsdContext` and `LsdScenario` as its only subclasses (the capture block joins in slice 4). The verbs are final. Each subclass supplies two internal hooks, `emit(events)` and `fact(key, value)`. The context's hooks go to its bound scenario; a scenario's hooks go to itself. Every verb ends with `at: Instant? = null`, which becomes the event's `createdAt`.
- The verbs are §3.1's, minus `call` (slice 5). `async` and `capture(vararg SequenceEventBuilder)` stay. The old `message(from, to, label, type, data, colour, durationMs)`, `noteLeft`/`noteRight`, `note(text, over)`, `shortInbound`/`shortOutbound` and `addFact`/`capture` copies on `LsdContext` and `LsdScenario` were deleted, not deprecated. `note(text)` with `side = OVER` requires `on`. `activate` ignores a blank colour, as before.
- **`data` before `type`.** Four existing positional calls still compiled after the reorder, with `MessageType.X` silently landing in `data`. I found them with a search over every `message(` call and fixed them. A Java caller that wants `at` passes the defaults before it (`MessageType.SYNCHRONOUS`, `null`); the core README says so.
- **The events are internal**: `SequenceEvent` and its seven classes, `Capturer.capture(vararg SequenceEvent)` (tests only) and `MessageBuilder.id()` are gone from the dump. The context gives every event its id when it is captured. The builders used to take ids as they were built, inside the same `capture` call, so the order and the ids are the same, and the sample reports are byte-identical. A short inbound or outbound message holds its diagram-edge end as `null`; the JSON and the insights still write `""`.
- **Kept public until slice 4:** `LifelineAction`, which `LifelineBuilder` and the infix `lifeline` still need. `NotePlacement` became the public `NoteSide` because the `note` verb takes it. The report UI's TypeScript keeps its own `NotePlacement` name.
- `Participant.alias` is now `displayName`, also on `ParticipantType.called`. The JSON field is still `alias`.
- **Not done:**
  - `Status.WARN` (optional) was left for a decision; slice 4 did it.
  - No slice 3 function takes a lambda, so the `Consumer` overloads come with `capture {}` in slice 4; the pattern is the one checked above.
  - `wrap(Callable)` from §2 is still not added.
- `JavaApiTest` (core, `src/test/java`) calls every verb and its shorter overloads from Java, as well as the builders, `CaptureDslKt`, `payloads.register`, `beginScenario` with try-with-resources `bind()`, `ScenarioError.of` and `LsdContext.getInstance()`. It asserts the captured event kinds, their order and `createdAt`.
- Cucumber uses `scenario.section(...)`.

### Slice 4 as built

- `CaptureBlock` is the third `Capturer`. It lives in `core`, not `core.capture`, because a sealed class's subclasses must share its package.
- **Arrows:**
  - `calls`, `repliesTo` and `sends` are member extensions on `String`, so they only resolve inside a block.
  - **Deviation from §4:** `label`, `data`, `took`, `colour` and `at` are member infix functions of `MessageSpec`, not extensions declared on the block. Kotlin reads the same, and Java can chain them: `c.calls("A", "B").label("x").data(body)`.
  - There are no `Participant` overloads (the old `messages` had them); pass the name or id.
  - `LOST` and `BI_DIRECTIONAL` have no arrow; inside or outside a block, use `message(from, to, label, MessageType.LOST)`.
- **One scenario, one append:**
  - `LsdContext.capture { }` resolves its target once, at the start.
  - The block collects its events, then binds and appends them with one `addAll` under the scenario's lock when it ends. It does this even when the block throws, so a failing test still shows what happened up to the failure.
  - Facts are added at once.
  - After the block, its receiver throws `IllegalStateException`.
  - A late block logs one warning for the batch.
- **#27 still holds inside a block:** message data is copied when its line runs (the `data` infix or a verb), not when the block ends.
- **Consumer overloads:** `LsdContext.capture`, `LsdScenario.capture` and the top-level `lsd` each have a `@JvmSynthetic` Kotlin form and a `Consumer<CaptureBlock>` form. `@file:JvmName("Lsd")` gives Java `Lsd.lsd(c -> …)`.
- **The `@LsdDsl` marker** is internal and only on `CaptureBlock`. With one DSL receiver it changes little yet; it matters when the `scenario {}` and `report {}` receivers arrive in slice 6.
- **Removed:**
  - `MessageBuilder`, `LifelineBuilder` and `SequenceEventBuilder`.
  - `CaptureDslKt`: `messages`, the `with*` infixes, `lifeline`, `noteOver`/`noteLeft`/`noteRight`, `logicalDivider`, `section`, `delay`, `spacer`, `shortInbound`/`shortOutbound`.
  - `Capturer.capture(vararg SequenceEventBuilder)`.
- `LifelineAction` is now internal.
- **`Status.FAILURE` is now `WARN`** (approved). Only the Kotlin name changed: the JSON was already `"warn"`, so the UI and the golden files are unchanged. JUnit's disabled and aborted tests, and Cucumber's non-passed, non-failed results, map to it, as before.
- **The positional trap from slice 3 is closed:**
  - `message(from, to, label, type: MessageType)` is an overload with no defaults. Kotlin and Java both pick it over `data: Any?` because it is more specific, so `message(a, b, label, MessageType.LOST)` sets the type.
  - The old five-argument order (`type` then `data`) no longer compiles.
  - Calls with fewer arguments can only match the full form, so they are not ambiguous.
- **Samples:**
  - The README examples and the sample programs capture in blocks. Helpers became `CaptureBlock` extensions.
  - The kitchen sink's out-of-order scenario keeps the direct verbs with `at`, because it imitates interceptors on other threads.
  - The sample reports are byte-identical.

### Slice 5 as built

- `call(from, to, label, data, at)` is on `Capturer`, so `LsdContext`, `LsdScenario` and the capture block all have it. The context resolves its scenario once, so the request and the reply always land in the same scenario.
- **`PendingCall`:**
  - `reply(label, data, at)` and `fail(error, at)`, both `@JvmOverloads`.
  - **Deviation:** `fail` takes an optional `at`, which §3.1 doesn't show.
  - The response goes from the callee back to the caller as `SYNCHRONOUS_RESPONSE`.
  - Its `durationMs` is the time since `call`, from `System.nanoTime()`. When both the call and the reply have an `at`, it is the time between them instead.
  - The duration is on the response, and the request has none. The bottleneck tree already adds a request's and its response's durations.
  - `fail` labels the reply with the exception's simple name, with data `{exception: <class name>, message}`, as §3.1 says. It adds no colour.
- **Threads:**
  - `PendingCall` holds its scenario, so a reply from any thread (an executor, a `CompletableFuture` callback) lands there.
  - In a capture block, a reply that comes before the block ends joins the block's events in order.
  - A reply that comes after goes to the scenario, after the block's events. The block now commits under a lock, so a reply racing the commit waits for it.
- **Double reply:** the first `reply` or `fail` wins. Later ones are ignored with a warning rather than an exception, because they usually come from interceptor error paths.
- **Unreplied calls:** when a scenario completes, every call still waiting is abandoned and listed in one warning. A later reply is dropped with the late-capture warning, which also covers calls made in the default scenario. `discard`, `clear` and stray captures dropped by `completeReport` abandon calls without a warning.
- **No automatic activation.** §3 doesn't specify it. Drawing bars automatically would add events that today's samples draw explicitly, and a call never replied to would leave a bar open. So `call` draws exactly two messages, like `message` plus `response`, and callers add `activate`/`deactivate` if they want bars.
- **`LsdHeaders.SCENARIO`** (`"lsd-scenario"`) from §3.3 was added here, because the README's Kafka example needs it.
- **Samples:** none were migrated. Their call durations are fixed numbers on the request (`took 412`), and `call` would put a measured duration on the response, which would change the byte-identical reports. The core README's new "Interceptors" section has the HTTP and Kafka examples.

### Risks

| Risk | Mitigation |
|---|---|
| Wide doc and sample churn (3 READMEs, 3 sample programs, about 60 test call sites) | Slice 4 does it all at once. The fixed-timestamp samples must produce identical JSON, which proves the rewrite changed nothing. |
| The experimental ABI DSL changes on a Kotlin bump | It's isolated in one convention plugin; Renovate runs CI on Kotlin bumps. |
| Hiding the event classes removes a lower-level extension point that a future interceptors library might want | The verbs cover every event kind. If a batch API is needed, `capture {}` is it. Re-check when the first real interceptor module is written. |
| `capture {}` appends at block end, so a long block and another thread's captures can interleave around it | Keep blocks short; long-running code belongs in `scenario {}` with direct verbs. Document it. |
| Thread binding doesn't survive coroutines or reactive hops | `PendingCall` and explicit `LsdScenario` references; later the optional coroutines module. |
| The top-level `lsd {}` gets shadowed by the common `val lsd = …` | It's only a shorthand. Inside classes, use `lsd.capture {}`. |
| The `Status` rename touches the JUnit and Cucumber outcome mapping | The JSON strings are unchanged; the existing outcome tests cover it. |
| I couldn't compile any of this here (no JDK on the box) | Checked in slice 3: `@JvmOverloads` on a sealed class and the `@JvmSynthetic` overloads both work (see "Slice 3 as built"). |
