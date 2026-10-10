package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.PayloadSnapshot
import io.lsdconsulting.lsd.mono.core.capture.SequenceEventBuilder
import io.lsdconsulting.lsd.mono.core.domain.Delay
import io.lsdconsulting.lsd.mono.core.domain.Divider
import io.lsdconsulting.lsd.mono.core.domain.Lifeline
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.NoteSide
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.ParticipantIds
import io.lsdconsulting.lsd.mono.core.domain.Scenario
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Section
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.Spacer
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.domain.orderByCreatedAt
import io.lsdconsulting.lsd.mono.core.model.DelayEventJson
import io.lsdconsulting.lsd.mono.core.model.DividerEventJson
import io.lsdconsulting.lsd.mono.core.model.EventJson
import io.lsdconsulting.lsd.mono.core.model.FactJson
import io.lsdconsulting.lsd.mono.core.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.core.model.MessageEventJson
import io.lsdconsulting.lsd.mono.core.model.NoteEventJson
import io.lsdconsulting.lsd.mono.core.model.ParticipantJson
import io.lsdconsulting.lsd.mono.core.model.ReportFile
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ReportOptionsJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioErrorJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioJson
import io.lsdconsulting.lsd.mono.core.model.SectionEventJson
import io.lsdconsulting.lsd.mono.core.model.SpacerEventJson
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import io.lsdconsulting.lsd.mono.core.report.capturedMetrics
import java.io.File
import java.nio.file.Path
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

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
 * **Metrics:** message count, summed `durationMs`, and ranked bottleneck or
 * slowest-message insights. Gated by [ReportOptions.metricsEnabled] (default on).
 * Labels in the shell truncate to [ReportOptions.labelMaxWidth].
 *
 * **Activate colour:** optional on [activate]; omitted from JSON when absent.
 * **Timestamps:** optional `createdAt` on events. [completeScenario] sorts by it
 * before the scenario is stored, so layout and JSON see the same order.
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
 * **Deferred:** legacy include-files.
 */
public class LsdContext : Capturer() {
    @Volatile
    internal var idGenerator = IdGenerator(LsdProperties.deterministicIds())
        private set

    /**
     * Copies message data when it is captured (see [PayloadSnapshot]). Register
     * converters here; limits come from `lsd.mono.payload.*` and are re-read by [clear].
     */
    public val payloads: PayloadSnapshot = PayloadSnapshot()

    /** Re-read on each access so tests can point a long-lived instance at a TempDir. */
    internal val outputDirectory: File
        get() = File(LsdProperties.outputDirectory())

    /** Guards report-level state: participants, completed scenarios, report files. */
    private val lock = Any()
    private val completed = LinkedHashMap<String?, MutableList<Pair<Long, Scenario>>>()
    private val reportFiles: MutableList<ReportFile> = ArrayList()
    private val participants = linkedMapOf<String, Participant>()

    private val sequence = AtomicLong()
    private val active = ConcurrentHashMap<String, LsdScenario>()
    private val bound = ThreadLocal<LsdScenario>()

    /** Unbound captures with no scenario running. Completed by [completeScenario], as before. */
    private val defaultScenario = LsdScenario(this, key = "", reportKey = null, sequence = 0)

    @Volatile
    private var warnedAmbiguous = false

    public fun addParticipants(vararg additional: Participant): Unit = addParticipants(additional.toList())

    public fun addParticipants(additional: List<Participant>) {
        synchronized(lock) {
            additional.forEach { incoming ->
                val id =
                    if (participants.containsKey(incoming.id) && participants[incoming.id]?.name != incoming.name) {
                        uniqueId(incoming.id)
                    } else {
                        incoming.id
                    }
                participants[id] = incoming.copy(id = id)
            }
        }
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
    ): LsdScenario {
        val scenario = LsdScenario(this, key, reportKey, sequence.incrementAndGet())
        synchronized(lock) {
            check(!active.containsKey(key)) { "A scenario with key '$key' is already running" }
            if (active.isEmpty() && !defaultScenario.isEmpty()) scenario.addAll(defaultScenario.drain())
            active[key] = scenario
        }
        if (bindCurrentThread) bound.set(scenario)
        return scenario
    }

    /** The scenario the calling thread is bound to, if it is still running. */
    public fun currentScenario(): LsdScenario? = bound.get()?.takeIf { isActive(it) }

    /** A running scenario by the key it was begun with. */
    public fun findScenario(key: String): LsdScenario? = active[key]

    /**
     * Wrap [task] so it runs bound to the calling thread's current scenario, for
     * handing work to an executor. Returns [task] unchanged when there is none.
     */
    public fun wrap(task: Runnable): Runnable = currentScenario()?.wrap(task) ?: task

    /**
     * @param error structured failure (message + stack). Prefer this over HTML overlay
     * markup in [description].
     */
    @JvmOverloads
    public fun completeScenario(
        title: String,
        description: String? = "",
        status: Status = Status.SUCCESS,
        error: ScenarioError? = null,
    ) {
        complete(target(), title, description, status, error)
    }

    /**
     * Write the scenarios completed for [reportKey] (the default report when null)
     * and forget them. File names come from the title plus a short hash of
     * `reportKey ?: title`, so reports with the same title do not overwrite each other.
     */
    @JvmOverloads
    public fun completeReport(title: String, reportKey: String? = null): Path {
        val taken =
            synchronized(lock) {
                // Writing a report has always dropped captures that no scenario was completed for.
                // Keep that when nothing is running, but say so.
                if (reportKey == null || active.isEmpty()) dropStrayCaptures(title)
                completed
                    .remove(reportKey)
                    .orEmpty()
                    .sortedBy { it.first }
                    .map { it.second }
            }
        val report = buildReportJson(title, taken)
        val path = ReportWriter.writeReport(report = report, outputDir = outputDirectory, reportKey = reportKey)
        synchronized(lock) {
            reportFiles.add(
                ReportFile(
                    filename = path.fileName.toString(),
                    title = report.title,
                    status = report.status,
                ),
            )
        }
        return path
    }

    /**
     * Write `index.html` listing every report in the output directory, including
     * reports written by other test JVMs (Gradle forks) or modules sharing it.
     */
    public fun createIndex(): Path = ReportWriter.writeIndex(synchronized(lock) { reportFiles.toList() }, outputDirectory)

    public fun clear() {
        synchronized(lock) {
            idGenerator = IdGenerator(LsdProperties.deterministicIds())
            payloads.limits = PayloadSnapshot.Limits.fromProperties()
            completed.clear()
            reportFiles.clear()
            participants.clear()
            active.clear()
            defaultScenario.drain()
            warnedAmbiguous = false
        }
        bound.remove()
    }

    /** Into the current scenario: the bound one, the only running one, or the default. */
    override fun emit(events: List<SequenceEvent>) {
        captureInto(target(), events)
    }

    override fun fact(key: String, value: String) {
        target().addFact(key, value)
    }

    internal fun isActive(scenario: LsdScenario): Boolean =
        scenario === defaultScenario || active[scenario.key] === scenario

    internal fun captureInto(scenario: LsdScenario, events: List<SequenceEvent>) {
        events.forEach { event ->
            if (!scenario.addEvent(bind(event))) warnLate(scenario, "event")
        }
    }

    internal fun bindThread(scenario: LsdScenario): AutoCloseable {
        val previous = bound.get()
        bound.set(scenario)
        return AutoCloseable { if (previous == null) bound.remove() else bound.set(previous) }
    }

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
                if (!active.remove(scenario.key, scenario)) return
                scenario.close()
            }
        if (bound.get() === scenario) bound.remove()
        val events = orderByCreatedAt(captured)
        synchronized(lock) {
            val stored =
                Scenario(
                    title = title,
                    description = description.orEmpty(),
                    status = status,
                    facts = facts,
                    participants = participantsFor(events),
                    events = events,
                    error = error,
                )
            val order = if (scenario === defaultScenario) sequence.incrementAndGet() else scenario.sequence
            completed.getOrPut(scenario.reportKey) { ArrayList() }.add(order to stored)
        }
    }

    internal fun discard(scenario: LsdScenario) {
        if (scenario === defaultScenario) {
            defaultScenario.drain()
            return
        }
        if (active.remove(scenario.key, scenario)) scenario.close()
        if (bound.get() === scenario) bound.remove()
    }

    private fun dropStrayCaptures(report: String) {
        val (facts, events) = defaultScenario.drain()
        if (facts.isEmpty() && events.isEmpty()) return
        logger.log(
            System.Logger.Level.WARNING,
            "LSD: report '$report' dropped ${events.size} event(s) and ${facts.size} fact(s) captured outside " +
                "any scenario. Capture inside a test, or call completeScenario before completeReport.",
        )
    }

    internal fun warnLate(scenario: LsdScenario, what: String) {
        logger.log(
            System.Logger.Level.WARNING,
            "LSD: dropped a $what captured after scenario '${scenario.key}' finished. " +
                "Capture before the test ends, or wait for background work first.",
        )
    }

    /** Where an unscoped call goes: the bound scenario, the only running one, or the default. */
    private fun target(): LsdScenario {
        currentScenario()?.let { return it }
        val running = active.values.toList()
        if (running.size == 1) return running.single()
        if (running.size > 1 && !warnedAmbiguous) {
            warnedAmbiguous = true
            logger.log(
                System.Logger.Level.WARNING,
                "LSD: captured on thread '${Thread.currentThread().name}', which is not bound to a scenario, " +
                    "while ${running.size} scenarios are running in parallel. It cannot be attributed and goes to " +
                    "the default scenario. Use LsdScenario.bind() or LsdContext.wrap() on threads you start.",
            )
        }
        return defaultScenario
    }

    private fun bind(event: SequenceEvent): SequenceEvent =
        when (event) {
            is Message -> bindMessage(event)
            is Note ->
                event.copy(
                    id = event.id.ifBlank { idGenerator.next() },
                    over = event.over?.takeIf { it.isNotBlank() }?.let { resolve(it).id },
                )
            is Divider -> event.copy(id = event.id.ifBlank { idGenerator.next() })
            is Section -> event.copy(id = event.id.ifBlank { idGenerator.next() })
            is Delay -> event.copy(id = event.id.ifBlank { idGenerator.next() })
            is Spacer -> event.copy(id = event.id.ifBlank { idGenerator.next() })
            is Lifeline ->
                event.copy(
                    id = event.id.ifBlank { idGenerator.next() },
                    participantId = resolve(event.participantId).id,
                )
        }

    private fun bindMessage(captured: Message): Message {
        // Copy the data now, so later changes by the caller do not reach the report (#27).
        val event = if (captured.data == null) captured else captured.copy(data = payloads.snapshot(captured.data))
        val id = event.id.ifBlank { idGenerator.next() }
        return when (event.type) {
            MessageType.SHORT_INBOUND -> {
                val toRef = event.to.ifBlank { event.from }
                event.copy(id = id, from = "", to = resolve(toRef).id)
            }
            MessageType.SHORT_OUTBOUND -> {
                val fromRef = event.from.ifBlank { event.to }
                event.copy(id = id, from = resolve(fromRef).id, to = "")
            }
            else ->
                event.copy(
                    id = id,
                    from = resolve(event.from).id,
                    to = resolve(event.to).id,
                )
        }
    }

    private fun resolve(ref: String): Participant = synchronized(lock) { resolveLocked(ref) }

    private fun resolveLocked(ref: String): Participant {
        participants[ref]?.let { return it }
        participants.values.firstOrNull { it.name == ref || it.alias == ref }?.let { return it }
        val id = uniqueId(ParticipantIds.fromName(ref))
        val created = Participant(name = ref, id = id)
        participants[id] = created
        return created
    }

    private fun uniqueId(base: String): String {
        if (!participants.containsKey(base)) return base
        var n = 2
        while (participants.containsKey("$base-$n")) n++
        return "$base-$n"
    }

    private fun participantsFor(events: List<SequenceEvent>): List<Participant> {
        val ids = linkedSetOf<String>()
        events.forEach { event ->
            when (event) {
                is Message -> {
                    if (event.from.isNotBlank()) ids.add(event.from)
                    if (event.to.isNotBlank()) ids.add(event.to)
                }
                is Note -> event.over?.let { ids.add(it) }
                is Lifeline -> ids.add(event.participantId)
                is Divider, is Section, is Delay, is Spacer -> Unit
            }
        }
        return participants.values.filter { it.id in ids }
    }

    private fun buildReportJson(title: String, scenarios: List<Scenario>): ReportJson =
        ReportJson(
            title = title,
            // UTC instant. The report page shows it in the reader's own time zone.
            // lsd.mono.report.generatedAt fixes it, for reproducible samples.
            generatedAt = (LsdProperties.generatedAt() ?: Instant.now()).truncatedTo(ChronoUnit.MILLIS).toString(),
            generator = LsdVersion.generator,
            status = determineOverallStatus(scenarios),
            options = reportOptions().toJson(),
            scenarios = scenarios.map { scenario -> scenario.toJsonModel(reportOptions()) },
        )

    private fun reportOptions(): ReportOptions = ReportOptions.fromProperties()

    private fun ReportOptions.toJson(): ReportOptionsJson =
        ReportOptionsJson(metricsEnabled = metricsEnabled, labelMaxWidth = labelMaxWidth)

    private fun Scenario.toJsonModel(options: ReportOptions): ScenarioJson {
        val captured = capturedMetrics(events, options)
        return ScenarioJson(
            id = idGenerator.next(),
            title = title,
            status = status.toReportStatus(),
            description = description,
            facts = facts.map { FactJson(it.key, it.value) },
            error = error?.let { ScenarioErrorJson(it.headline, it.message, it.stack) },
            metrics = captured.metrics,
            insights = captured.insights,
            participants =
                participants.map {
                    ParticipantJson(
                        id = it.id,
                        name = it.name,
                        type = it.type.name,
                        alias = it.alias,
                        colour = it.colour,
                    )
                },
            events = events.map { it.toEventJson() },
        )
    }

    private fun SequenceEvent.toEventJson(): EventJson =
        when (this) {
            is Message ->
                MessageEventJson(
                    id = id,
                    from = from,
                    to = to,
                    label = label,
                    type = type.name,
                    colour = colour?.takeIf { it.isNotBlank() },
                    durationMs = durationMs,
                    data = data,
                    createdAt = createdAt?.toString(),
                )
            is Note ->
                NoteEventJson(
                    id = id,
                    text = text,
                    over = over,
                    placement = placement.name.lowercase(),
                    createdAt = createdAt?.toString(),
                )
            is Divider -> DividerEventJson(id = id, label = label, createdAt = createdAt?.toString())
            is Section -> SectionEventJson(id = id, title = title, createdAt = createdAt?.toString())
            is Delay -> DelayEventJson(id = id, label = label, createdAt = createdAt?.toString())
            is Spacer -> SpacerEventJson(id = id, heightPx = heightPx, createdAt = createdAt?.toString())
            is Lifeline ->
                LifelineEventJson(
                    kind = if (action == LifelineAction.ACTIVATE) "activate" else "deactivate",
                    id = id,
                    participantId = participantId,
                    colour = if (action == LifelineAction.ACTIVATE) colour?.takeIf { it.isNotBlank() } else null,
                    createdAt = createdAt?.toString(),
                )
        }

    private fun determineOverallStatus(scenarios: List<Scenario>): String =
        scenarios
            .map { it.status }
            .sortedWith(
                compareBy {
                    when (it) {
                        Status.ERROR -> 0
                        Status.FAILURE -> 1
                        Status.SUCCESS -> 2
                    }
                },
            ).firstOrNull()
            ?.toCssClass()
            ?: "success"

    public companion object {
        private val logger = System.getLogger(LsdContext::class.java.name)

        @JvmStatic
        public val instance: LsdContext = LsdContext()
    }
}
