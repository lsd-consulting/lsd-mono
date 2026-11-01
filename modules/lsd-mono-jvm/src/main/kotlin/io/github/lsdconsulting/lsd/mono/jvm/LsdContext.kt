package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.Message
import io.github.lsdconsulting.lsd.mono.jvm.domain.Participant
import io.github.lsdconsulting.lsd.mono.jvm.domain.Scenario
import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioError
import io.github.lsdconsulting.lsd.mono.jvm.domain.SequenceEvent
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.domain.orderAndAnalyse
import io.github.lsdconsulting.lsd.mono.jvm.live.LiveCapture
import io.github.lsdconsulting.lsd.mono.jvm.live.LiveFrames
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.report.ReportJsonMapper
import io.github.lsdconsulting.lsd.mono.jvm.report.reportWriter
import io.github.lsdconsulting.lsd.mono.report.model.KnownReportSource
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import java.io.File
import java.net.URI
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.atomic.AtomicLong
import java.util.function.Consumer

/**
 * Capture + report façade inspired by legacy `com.lsd.core.LsdContext`.
 *
 * **Mirrored:** participants, facts, `capture` of messages / responses / notes
 * (over / left / right) / delays / spacers / short arrows / logical dividers /
 * lifelines, scenario completion, report + index writers.
 * Completing a report serialises [ReportJson] (the report shape) and injects
 * it into the interactive SVG shell.
 *
 * **Sections** (`section`) replace PlantUML `newpage`: they stay in the same
 * event stream and do not drop lifeline activations.
 *
 * **Metrics:** message count and captured duration (each call's `took` or `Timing`
 * duration, else call-to-reply time, counted once). Slow calls show in the Timing view. Gated by [ReportOptions.metricsEnabled] (default on).
 * Labels in the shell truncate to [ReportOptions.labelMaxWidth].
 *
 * **Activate colour:** optional on [activate]; omitted from JSON when absent.
 * **Timing:** see `domain/EventTiming.kt`. [completeScenario] pairs calls and replies, works out
 * each scenario's accuracy and applies clock ordering ([TimingConfig.orderByStartedAt]) before the scenario
 * is stored, so layout and JSON see the same order.
 *
 * **Threads:** every method is thread-safe. Each running scenario has its own
 * buffer ([LsdScenario]). A thread that called [beginScenario] captures into that
 * scenario. A thread that is not bound captures into the only running scenario, or
 * into the default scenario when there are none, which is how single-threaded code
 * has always worked. With several scenarios running, an unbound capture cannot be
 * attributed: it goes to the default scenario and a warning is logged once. Use
 * [LsdScenario.bind] or [wrap] to carry a scenario onto other threads.
 *
 * **Reports:** scenarios are grouped by [LsdScenario.reportKey], so parallel test
 * classes or features each get their own report from [completeReport].
 *
 * **Getting one:** [LsdContext.instance] (`LsdContext.getInstance()` from Java).
 *
 * **Deferred:** legacy include-files.
 */
public class LsdContext internal constructor() :
    Capturer(),
    InteractionSink {
        /** Timing settings for scenarios completed from now on; change them with [configure]. */
        public val timingConfig: TimingConfig = TimingConfig()

        /**
         * Change [timingConfig], from Kotlin or Java alike, and return this context:
         * `lsd.configure { it.orderByStartedAt(ClockOrdering.ALL_SOURCES) }` or
         * `lsd.configure(t -> t.orderByStartedAt(ClockOrdering.OFF))`.
         */
        public fun configure(settings: Consumer<TimingConfig>): LsdContext = apply { settings.accept(timingConfig) }

        /** Same as [ingest]. */
        override fun accept(interaction: Interaction): Unit = ingest(interaction)

        @Volatile
        internal var idGenerator = IdGenerator(LsdProperties.deterministicIds())
            private set

        /**
         * Copies message data when it is captured (see [PayloadConverters]). Register
         * converters and redaction rules here; limits and the built-in redaction come from
         * `lsd.mono.payload.*` and are re-read by [clear].
         */
        public val payloads: PayloadConverters = PayloadConverters()

        /** Re-read on each access so tests can point a long-lived instance at a TempDir. */
        internal val outputDirectory: File
            get() = File(LsdProperties.outputDirectory())

        /** Guards report-level state: participants, scenarios and [reports]. Reentrant, as `synchronized` is. */
        private val lock = Any()
        private val reports = CompletedReports(lock)

        /** Shared by the context's participant registries, so their participants keep registration order. */
        private val participantOrder = AtomicLong()

        /** Declared outside any scenario: every scenario sees these. */
        private val participants = ParticipantRegistry(participantOrder)
        private val jsonMapper = ReportJsonMapper { idGenerator.next() }

        /** Streams reports to LSD Studio while they run, when `lsd.mono.studio.url` is set. */
        private val live = LiveCapture(LiveFrames(jsonMapper), url = LsdProperties::studioUrl)

        private val scenarios = ScenarioRegistry(this, lock)
        private val binder = EventBinder { idGenerator }

        /** The kinds of capture that have failed, so each is warned about once ([guarded]). */
        private val droppedKinds: MutableSet<String> = java.util.concurrent.ConcurrentHashMap
            .newKeySet()
        private val openReport = ThreadLocal<LsdReport>()

        private val defaultScenario get() = scenarios.defaultScenario

        /**
         * Declare participants, to give them a type (shape), display name or colour, and to fix
         * their order on the diagram. Events refer to them by name, id or display name. A
         * participant that is never declared is drawn as a plain [ParticipantType.PARTICIPANT]
         * the first time an event names it. Declaring an id twice with a different name keeps both,
         * with a numbered id for the second.
         *
         * Declarations go where captures do. Inside a scenario (the bound one, or the only running
         * one), they apply to that scenario only, so tests running in parallel can't change each
         * other's participants. Made with no scenario running (for example in a `@BeforeAll`), they
         * apply to every scenario, and a scenario's own declaration of the same id takes precedence.
         */
        public fun addParticipants(vararg additional: Participant): Unit = addParticipants(additional.toList())

        /** [addParticipants] for a list. */
        public fun addParticipants(additional: List<Participant>) {
            val scenario = target()
            synchronized(lock) { registryOf(scenario).declare(additional) }
        }

        /**
         * Start a scenario and, by default, bind the calling thread to it.
         * Test integrations call this when a test starts. With no other scenario running,
         * it takes over anything captured unbound since the last scenario finished (for
         * example in a `@BeforeAll`), as single-threaded runs always did.
         *
         * @param reportKey groups scenarios into one report; pass the same key to [completeReport].
         * @param key unique among running scenarios; [findScenario] looks it up.
         */
        @JvmOverloads
        public fun beginScenario(
            reportKey: String? = null,
            key: String = UUID.randomUUID().toString(),
            bindCurrentThread: Boolean = true,
        ): LsdScenario = scenarios.begin(reportKey, key, bindCurrentThread).also { live.begun(reportKey) }

        /**
         * The title [reportKey]'s report will be written with, given before its first scenario
         * begins, so a live capture to LSD Studio is titled from the start. For integrations.
         */
        @InternalLsdApi
        public fun reportTitle(
            reportKey: String?,
            title: String,
        ) {
            live.title(reportKey, title)
        }

        /**
         * The scenario the calling thread is bound to, if it is still running. That is the one
         * bound on this thread, or else one inherited from the thread that started it (see
         * [LsdScenario.bind] and the README on threads; pool workers do not inherit).
         */
        public fun currentScenario(): LsdScenario? = scenarios.current()

        /** A running scenario by the key it was begun with. */
        public fun findScenario(key: String): LsdScenario? = scenarios.find(key)

        /**
         * The value to send in the [LsdHeaders.SCENARIO] header on a request or message to [host]:
         * the current scenario's opaque [LsdScenario.correlationId], or null (send no header) when
         * no scenario is current or [host] is not allowed. Allowed hosts come from
         * `lsd.mono.propagation.allowedHosts`, by default only loopback (`localhost`,
         * `127.0.0.1`, `::1`), so a client interceptor never tags calls to third parties.
         */
        public fun scenarioHeaderValue(host: String): String? =
            guarded("scenario header", { null }) {
                if (!HostAllowList.fromProperties().allows(host)) return@guarded null
                currentScenario()?.correlationId
            }

        /** [scenarioHeaderValue] for the host of [uri]; null when it has none. */
        public fun scenarioHeaderValue(uri: URI): String? = guarded("scenario header", { null }) { uri.host?.let(::scenarioHeaderValue) }

        /**
         * The running scenario whose [LsdScenario.correlationId] is [headerValue], as received in
         * the [LsdHeaders.SCENARIO] header; null when none is running (or the value is null).
         */
        public fun findScenarioByHeader(headerValue: String?): LsdScenario? =
            guarded("scenario header lookup", { null }) {
                val wanted = headerValue?.trim()?.takeIf { it.isNotEmpty() } ?: return@guarded null
                scenarios.findByCorrelationId(wanted)
            }

        /**
         * The scenario a capture on the calling thread belongs to, for an integration that captures
         * on threads it does not start (an HTTP server's request threads, say) and needs the
         * scenario itself rather than an unscoped capture: the [currentScenario], else the only
         * running scenario. Null when no scenario is current and none, or several, are running, so
         * the caller can leave the event out rather than guess.
         */
        @InternalLsdApi
        public fun runningScenario(): LsdScenario? = guarded("running scenario", { null }) { currentScenario() ?: scenarios.onlyRunning() }

        /**
         * Wrap [task] so it runs bound to the calling thread's current scenario, for
         * handing work to an executor. Returns [task] unchanged when there is none.
         */
        public fun wrap(task: Runnable): Runnable = currentScenario()?.wrap(task) ?: task

        /** [wrap] for a task that returns a value. */
        public fun <T> wrap(task: Callable<T>): Callable<T> = currentScenario()?.wrap(task) ?: task

        /**
         * Run [block] as a scenario called [title], bound to the calling thread, and complete it
         * when the block ends: as [Status.SUCCESS], or, if the block throws, as [Status.ERROR]
         * with the exception as its [ScenarioError] before the exception is rethrown. The thread
         * gets back whatever scenario it was bound to before, so scenarios nest: an inner one
         * shadows the outer one until it ends. Scenarios on different threads are independent.
         *
         * ```kotlin
         * lsd.scenario("Place an order", description = "Given … When … Then …") {
         *     addFact("orderId", "ord-1001")
         *     capture { "Customer" calls "Web Shop" label "click Place order" }
         *     placeOrder()        // interceptors on this thread capture into this scenario
         * }
         * ```
         *
         * @param reportKey the report to add it to. By default, the [report] block running on
         * this thread, or else the default report.
         * @return what [block] returned.
         */
        @JvmSynthetic
        public fun <T> scenario(
            title: String,
            description: String? = null,
            reportKey: String? = null,
            block: LsdScenario.() -> T,
        ): T {
            val scenario = beginScenario(reportKey ?: openReport.get()?.key, bindCurrentThread = false)
            return scenario.bind().use {
                val result =
                    try {
                        scenario.block()
                    } catch (e: Throwable) {
                        scenario.complete(title, description, Status.ERROR, ScenarioError.of("Failed", e))
                        throw e
                    }
                scenario.complete(title, description)
                result
            }
        }

        /** Java form of [scenario]: `lsd.scenario("Place an order", s -> s.addFact("orderId", "ord-1001"))`. */
        @JvmOverloads
        public fun scenario(
            title: String,
            description: String? = null,
            reportKey: String? = null,
            block: Consumer<LsdScenario>,
        ): Unit = scenario(title, description, reportKey) { block.accept(this) }

        /**
         * Java form of [scenario] for a block that returns a value: `int n = lsd.scenario("Count", () -> count())`.
         * Capture through `lsd`, which is bound to the scenario inside the block.
         * It is a [Callable] rather than a `Function<LsdScenario, T>` because javac cannot choose
         * between `Consumer` and `Function` for a lambda such as `s -> s.addFact("k", "v")`.
         */
        @JvmOverloads
        public fun <T> scenario(
            title: String,
            description: String? = null,
            reportKey: String? = null,
            block: Callable<T>,
        ): T = scenario(title, description, reportKey) { block.call() }

        /**
         * Run [block] as one report called [title], then write it with [completeReport] and
         * update the index with [createIndex]. The report has its own key, so `report { }`
         * blocks on parallel threads never mix scenarios. A [scenario] in the block, or in
         * code it calls on this thread, goes into this report. The report is written even when
         * the block throws, and the exception is rethrown.
         *
         * ```kotlin
         * val files = LsdContext.instance.report("Online shop") {
         *     scenario("Place an order") { capture { "Customer" calls "Web Shop" label "click Place order" } }
         *     scenario("Card declined") { … }
         * }
         * ```
         *
         * @return the files written; open [ReportFiles.diagramHtml].
         */
        @JvmSynthetic
        public fun report(
            title: String,
            block: LsdReport.() -> Unit,
        ): ReportFiles {
            val report = LsdReport(this, title, reports.open(title))
            val previous = openReport.get()
            openReport.set(report)
            val failure =
                try {
                    report.block()
                    null
                } catch (e: Throwable) {
                    e
                } finally {
                    if (previous == null) openReport.remove() else openReport.set(previous)
                }
            val path =
                try {
                    completeReport(title, report.key).also { createIndex() }
                } catch (e: Throwable) {
                    if (failure == null) throw e
                    failure.addSuppressed(e)
                    null
                } finally {
                    reports.close(report.key)
                }
            if (failure != null) throw failure
            return checkNotNull(path)
        }

        /** Java form of [report]: `ReportFiles files = lsd.report("Online shop", r -> r.scenario("Place an order", s -> { … }));`. */
        public fun report(
            title: String,
            block: Consumer<LsdReport>,
        ): ReportFiles = report(title) { block.accept(this) }

        /**
         * @param error structured failure (message + stack). Prefer this over HTML overlay
         * markup in [description].
         */
        @JvmOverloads
        public fun completeScenario(
            title: String,
            description: String? = null,
            status: Status = Status.SUCCESS,
            error: ScenarioError? = null,
        ) {
            complete(target(), title, description, status, error)
        }

        /**
         * Write the scenarios completed for [reportKey] (the default report when null)
         * and forget them. File names come from the title plus a short hash of
         * `reportKey ?: title`, so reports with the same title do not overwrite each other.
         *
         * @return the files written; open [ReportFiles.diagramHtml].
         */
        @JvmOverloads
        public fun completeReport(title: String, reportKey: String? = null): ReportFiles = writeReport(title, reportKey, KnownReportSource.API)

        /**
         * [completeReport] for a test integration: [source] (`junit` or `cucumber`) is recorded in the
         * report's options, and the usage ping counts it once when the report is opened.
         */
        @InternalLsdApi
        public fun completeReport(title: String, reportKey: String?, source: String): ReportFiles = writeReport(title, reportKey, source, title)

        /**
         * [completeReport] for a test integration whose file names come from [fileTitle] rather than
         * the [title] shown in the report, so a better title does not rename the files.
         */
        @InternalLsdApi
        public fun completeReport(
            title: String,
            reportKey: String?,
            source: String,
            fileTitle: String,
        ): ReportFiles = writeReport(title, reportKey, source, fileTitle)

        private fun writeReport(
            title: String,
            reportKey: String?,
            source: String,
            fileTitle: String = title,
        ): ReportFiles {
            completeStillRunning(title, reportKey)
            val taken =
                synchronized(lock) {
                    // Writing a report has always dropped captures that no scenario was completed for.
                    // Keep that when nothing is running, but say so.
                    if (reportKey == null || scenarios.isEmpty()) dropStrayCaptures(title)
                    reports.take(reportKey)
                }
            val report = jsonMapper.toReportJson(title, taken, source)
            val written = reportWriter().writeReport(report = report, outputDir = outputDirectory.toPath(), reportKey = reportKey, fileTitle = fileTitle)
            reports.written(written)
            live.written(reportKey)
            return ReportFiles(diagramHtml = written.diagramHtml, reportJson = written.reportJson)
        }

        /**
         * Write `index.html` listing every report in the output directory, including
         * reports written by other test JVMs (Gradle forks) or modules sharing it.
         */
        public fun createIndex(): Path = reportWriter().writeIndex(outputDirectory.toPath(), reports.writtenSoFar())

        /**
         * Forget everything: participants, running and completed scenarios, the default scenario's
         * captures and the reports written so far (files on disk stay). Calls still waiting for a
         * reply are abandoned without a warning. Re-reads the properties (deterministic ids, payload
         * limits and redaction) and keeps the registered payload converters and redaction rules. For test isolation.
         */
        public fun clear() {
            synchronized(lock) {
                idGenerator = IdGenerator(LsdProperties.deterministicIds())
                binder.reset()
                payloads.limits = PayloadConverters.Limits.fromProperties()
                payloads.redaction = PayloadConverters.Redaction.fromProperties()
                reports.clear()
                participants.clear()
                scenarios.clear()
            }
            scenarios.unbindCurrentThread()
        }

        /**
         * Capture several events together, into the current scenario: the bound one, the only
         * running one, or the default. The scenario is picked once, when the block starts, and
         * the events are added together when it ends. See [CaptureBlock].
         */
        @JvmSynthetic
        public fun capture(block: CaptureBlock.() -> Unit): Unit = target().capture(block)

        /** Java form of [capture]: `lsd.capture(c -> { c.message("A", "B"); c.activate("B"); })`. */
        public fun capture(block: Consumer<CaptureBlock>): Unit = target().capture(block)

        /** Into the current scenario: the bound one, the only running one, or the default. */
        override fun emit(events: List<SequenceEvent>) {
            guarded("event", { }) { captureInto(target(), events) }
        }

        override fun fact(key: String, value: String) {
            guarded("fact", { }) { target().addFact(key, value) }
        }

        override fun startCall(request: Message): PendingCall =
            guarded("call", { PendingCall.detached(defaultScenario, request) }) { target().startCall(request) }

        internal fun isActive(scenario: LsdScenario): Boolean = scenarios.isActive(scenario)

        /**
         * Bind [events] and add them to [scenario] together. [dataCopied] is true when a
         * capture block already copied the message data, at the line that wrote it.
         */
        internal fun captureInto(
            scenario: LsdScenario,
            events: List<SequenceEvent>,
            dataCopied: Boolean = false,
        ) {
            if (events.isEmpty()) return
            guarded(if (events.size == 1) "event" else "batch of events", { }) {
                val resolve = { ref: String -> resolve(scenario, ref) }
                val bound = events.map { binder.bind(if (dataCopied) it else copyData(it), resolve) }
                if (!scenario.addEvents(bound)) CaptureLog.late(scenario, if (bound.size == 1) "event" else "batch of ${bound.size} events")
            }
        }

        /**
         * Run [block], a capture an interceptor may make from inside the application under test.
         * If it fails, log and return [fallback] instead of throwing into the application: the
         * diagram is short of what failed, the request still succeeds (#49). The first failure
         * of each [kind] is a WARNING with its stack trace, later ones DEBUG. A
         * [VirtualMachineError] (out of memory, stack overflow) still propagates.
         *
         * Not used for the test DSL ([CaptureBlock] misuse, a note over nobody, scenario lifecycle),
         * where a mistake is in the test itself and should fail it.
         */
        internal fun <T> guarded(
            kind: String,
            fallback: () -> T,
            block: () -> T,
        ): T =
            try {
                block()
            } catch (e: VirtualMachineError) {
                throw e
            } catch (e: Throwable) {
                CaptureLog.dropped(kind, e, first = droppedKinds.add(kind))
                fallback()
            }

        /** Copy a message's data now, so later changes by the caller do not reach the report (#27). */
        internal fun copyData(event: SequenceEvent): SequenceEvent =
            if (event is Message && event.data != null) event.copy(data = payloads.snapshot(event.data)) else event

        internal fun bindThread(scenario: LsdScenario): LsdBinding = scenarios.bindThread(scenario)

        internal fun complete(
            scenario: LsdScenario,
            title: String,
            description: String?,
            status: Status,
            error: ScenarioError?,
        ) {
            val (facts, captured) =
                if (scenario === defaultScenario) {
                    defaultScenario.drain()
                } else {
                    if (!scenarios.remove(scenario)) return
                    scenario.close()
                }
            scenarios.forget(scenario)
            CaptureLog.unreplied(title, scenario.abandonCalls())
            val (events, timing) = orderAndAnalyse(captured, timingConfig.effectiveOrderByStartedAt())
            val stored =
                synchronized(lock) {
                    val stored =
                        Scenario(
                            title = title,
                            description = description.orEmpty(),
                            status = status,
                            facts = facts,
                            participants = registryOf(scenario).usedBy(events, sharedWith(scenario)),
                            events = events,
                            error = error,
                            timing = timing,
                        )
                    val order = if (scenario === defaultScenario) scenarios.nextOrder() else scenario.sequence
                    reports.add(scenario.reportKey, order, stored)
                    stored
                }
            live.completed(scenario.reportKey, stored)
        }

        internal fun discard(scenario: LsdScenario) {
            scenario.abandonCalls()
            if (scenario === defaultScenario) {
                defaultScenario.drain()
                return
            }
            if (scenarios.remove(scenario)) scenario.close()
            scenarios.forget(scenario)
        }

        /**
         * Scenarios for this report that are still running are completed now, as [Status.WARN] with
         * [NOT_COMPLETED_NOTE] as their description, so they appear in the report and stop attracting
         * captures. A scenario completed concurrently by its test keeps that completion.
         */
        private fun completeStillRunning(title: String, reportKey: String?) {
            val running = scenarios.running(reportKey)
            if (running.isEmpty()) return
            CaptureLog.stillRunning(title, running)
            running.forEach { complete(it, it.key, NOT_COMPLETED_NOTE, Status.WARN, null) }
        }

        private fun dropStrayCaptures(report: String) {
            defaultScenario.abandonCalls()
            val (facts, events) = defaultScenario.drain()
            if (facts.isNotEmpty() || events.isNotEmpty()) CaptureLog.strayCaptures(report, events.size, facts.size)
        }

        /** Where an unscoped call goes: the bound scenario, the only running one, or the default. */
        private fun target(): LsdScenario = scenarios.target()

        private fun resolve(
            scenario: LsdScenario,
            ref: String,
        ): Participant = synchronized(lock) { registryOf(scenario).resolve(ref, sharedWith(scenario)) }

        internal fun newParticipantRegistry(): ParticipantRegistry = ParticipantRegistry(participantOrder)

        /** The default scenario uses the context's own registry; a scenario its own. */
        private fun registryOf(scenario: LsdScenario): ParticipantRegistry =
            if (scenario === defaultScenario) participants else scenario.participants

        private fun sharedWith(scenario: LsdScenario): ParticipantRegistry? = if (scenario === defaultScenario) null else participants

        /** Holds [instance]. */
        public companion object {
            internal const val NOT_COMPLETED_NOTE: String =
                "Scenario was not completed before the report was written. Its events up to that point are shown."

            /**
             * The shared context that the JUnit and Cucumber integrations use, and that
             * interceptors and the top-level `lsd { }` capture into. It is the only context: the
             * constructor is internal, so lsd-mono's own tests can make isolated ones.
             */
            @JvmStatic
            public val instance: LsdContext = LsdContext()
        }
    }
