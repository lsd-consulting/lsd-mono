package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.SequenceEventBuilder
import io.lsdconsulting.lsd.mono.core.domain.Delay
import io.lsdconsulting.lsd.mono.core.domain.Divider
import io.lsdconsulting.lsd.mono.core.domain.Fact
import io.lsdconsulting.lsd.mono.core.domain.Lifeline
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.NotePlacement
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.ParticipantIds
import io.lsdconsulting.lsd.mono.core.domain.Scenario
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Section
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.orderByCreatedAt
import io.lsdconsulting.lsd.mono.core.domain.Spacer
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.model.DelayEventJson
import io.lsdconsulting.lsd.mono.core.model.DividerEventJson
import io.lsdconsulting.lsd.mono.core.model.EventJson
import io.lsdconsulting.lsd.mono.core.model.FactJson
import io.lsdconsulting.lsd.mono.core.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.core.model.MessageEventJson
import io.lsdconsulting.lsd.mono.core.model.ReportOptionsJson
import io.lsdconsulting.lsd.mono.core.model.NoteEventJson
import io.lsdconsulting.lsd.mono.core.model.ParticipantJson
import io.lsdconsulting.lsd.mono.core.model.ReportFile
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioErrorJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioJson
import io.lsdconsulting.lsd.mono.core.model.SectionEventJson
import io.lsdconsulting.lsd.mono.core.model.SpacerEventJson
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import io.lsdconsulting.lsd.mono.core.report.capturedMetrics
import java.io.File
import java.nio.file.Path
import java.time.OffsetDateTime
import java.time.ZoneId

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
 * **Deferred:** legacy include-files.
 */
open class LsdContext {

    var idGenerator = IdGenerator(LsdProperties.deterministicIds())
        private set

    /** Re-read on each access so tests can point a long-lived instance at a TempDir. */
    val outputDirectory: File
        get() = File(LsdProperties.outputDirectory())

    private val scenarios: MutableList<Scenario> = ArrayList()
    private val reportFiles: MutableList<ReportFile> = ArrayList()
    private val participants = linkedMapOf<String, Participant>()
    private val currentFacts: MutableList<Fact> = ArrayList()
    private val currentEvents: MutableList<SequenceEvent> = ArrayList()

    fun addParticipants(vararg additional: Participant) = addParticipants(additional.toList())

    fun addParticipants(additional: List<Participant>) {
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

    fun addFact(key: String, value: String = "") {
        currentFacts.add(Fact(key, value))
    }

    /**
     * Capture sequence events for the current scenario. Names that have not been
     * [addParticipants]'d are registered as plain participants (slug id).
     */
    open fun capture(vararg events: SequenceEvent) {
        events.forEach { currentEvents.add(bind(it)) }
    }

    /** Same as [capture] for builders (`"A" messages "B" withLabel "..."`). */
    fun capture(vararg builders: SequenceEventBuilder) {
        capture(*builders.map { it.build(idGenerator) }.toTypedArray())
    }

    @JvmOverloads
    fun message(
        from: String,
        to: String,
        label: String,
        type: MessageType = MessageType.SYNCHRONOUS,
        data: Any? = null,
        colour: String? = null,
        durationMs: Long? = null,
    ) {
        capture(
            Message(
                id = idGenerator.next(),
                from = from,
                to = to,
                label = label,
                type = type,
                colour = colour,
                data = data,
                durationMs = durationMs,
            ),
        )
    }

    @JvmOverloads
    fun response(
        from: String,
        to: String,
        label: String,
        data: Any? = null,
        durationMs: Long? = null,
    ) {
        message(
            from = from,
            to = to,
            label = label,
            type = MessageType.SYNCHRONOUS_RESPONSE,
            data = data,
            durationMs = durationMs,
        )
    }

    fun note(text: String, over: String) {
        capture(Note(id = idGenerator.next(), text = text, over = over, placement = NotePlacement.OVER))
    }

    @JvmOverloads
    fun noteLeft(text: String, of: String? = null) {
        capture(Note(id = idGenerator.next(), text = text, over = of, placement = NotePlacement.LEFT))
    }

    @JvmOverloads
    fun noteRight(text: String, of: String? = null) {
        capture(Note(id = idGenerator.next(), text = text, over = of, placement = NotePlacement.RIGHT))
    }

    fun divider(label: String) {
        capture(Divider(id = idGenerator.next(), label = label))
    }

    /**
     * Insert a titled section in the current scenario.
     * Unlike legacy `newpage`, this does not split the diagram or deactivate lifelines.
     */
    fun section(title: String) {
        capture(Section(id = idGenerator.next(), title = title))
    }

    @JvmOverloads
    fun delay(label: String? = null) {
        capture(Delay(id = idGenerator.next(), label = label))
    }

    @JvmOverloads
    fun spacer(heightPx: Int? = null) {
        capture(Spacer(id = idGenerator.next(), heightPx = heightPx))
    }

    @JvmOverloads
    fun shortInbound(to: String, label: String = "") {
        capture(
            Message(
                id = idGenerator.next(),
                from = "",
                to = to,
                label = label,
                type = MessageType.SHORT_INBOUND,
            ),
        )
    }

    @JvmOverloads
    fun shortOutbound(from: String, label: String = "") {
        capture(
            Message(
                id = idGenerator.next(),
                from = from,
                to = "",
                label = label,
                type = MessageType.SHORT_OUTBOUND,
            ),
        )
    }

    /**
     * @param colour optional activation-bar colour (for example `#c026d3`).
     * Omitted from JSON when null or blank. The shell also draws a hatch, not colour alone.
     */
    @JvmOverloads
    fun activate(participant: String, colour: String? = null) {
        capture(
            Lifeline(
                id = idGenerator.next(),
                participantId = participant,
                action = LifelineAction.ACTIVATE,
                colour = colour?.takeIf { it.isNotBlank() },
            ),
        )
    }

    fun deactivate(participant: String) {
        capture(Lifeline(id = idGenerator.next(), participantId = participant, action = LifelineAction.DEACTIVATE))
    }

    /**
     * @param error structured failure (message + stack). Prefer this over HTML overlay
     * markup in [description].
     */
    @JvmOverloads
    fun completeScenario(
        title: String,
        description: String? = "",
        status: Status = Status.SUCCESS,
        error: ScenarioError? = null,
    ) {
        val events = orderByCreatedAt(currentEvents.toList())
        scenarios.add(
            Scenario(
                title = title,
                description = description.orEmpty(),
                status = status,
                facts = currentFacts.toList(),
                participants = participantsFor(events),
                events = events,
                error = error,
            ),
        )
        currentFacts.clear()
        currentEvents.clear()
    }

    fun completeReport(title: String): Path {
        val report = buildReportJson(title)
        val path =
            ReportWriter.writeReport(
                report = report,
                outputDir = outputDirectory,
                statusCss = report.status,
            )
        reportFiles.add(
            ReportFile(
                filename = path.fileName.toString(),
                title = report.title,
                status = report.status,
            ),
        )
        scenarios.clear()
        currentFacts.clear()
        currentEvents.clear()
        return path
    }

    fun createIndex(): Path = ReportWriter.writeIndex(reportFiles.toList(), outputDirectory)

    fun clear() {
        idGenerator = IdGenerator(LsdProperties.deterministicIds())
        scenarios.clear()
        reportFiles.clear()
        participants.clear()
        currentFacts.clear()
        currentEvents.clear()
    }

    /** Drops captured events for the in-flight scenario. Facts and participants stay. */
    fun clearScenarioEvents() {
        currentEvents.clear()
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

    private fun bindMessage(event: Message): Message {
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

    private fun resolve(ref: String): Participant {
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

    private fun buildReportJson(title: String): ReportJson =
        ReportJson(
            title = title,
            generatedAt = OffsetDateTime.now(ZoneId.of("Europe/London")).toString(),
            generator = "lsd-mono-core 0.0.1-SNAPSHOT",
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

    companion object {
        @JvmStatic
        val instance = LsdContext()
    }
}
