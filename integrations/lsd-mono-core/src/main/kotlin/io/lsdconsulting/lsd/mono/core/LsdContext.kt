package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.SequenceEventBuilder
import io.lsdconsulting.lsd.mono.core.domain.Divider
import io.lsdconsulting.lsd.mono.core.domain.Fact
import io.lsdconsulting.lsd.mono.core.domain.Lifeline
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.ParticipantIds
import io.lsdconsulting.lsd.mono.core.domain.Scenario
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.model.DividerEventJson
import io.lsdconsulting.lsd.mono.core.model.EventJson
import io.lsdconsulting.lsd.mono.core.model.FactJson
import io.lsdconsulting.lsd.mono.core.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.core.model.MessageEventJson
import io.lsdconsulting.lsd.mono.core.model.MetricJson
import io.lsdconsulting.lsd.mono.core.model.NoteEventJson
import io.lsdconsulting.lsd.mono.core.model.ParticipantJson
import io.lsdconsulting.lsd.mono.core.model.ReportFile
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioJson
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import java.io.File
import java.nio.file.Path
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * Capture + report façade inspired by legacy `com.lsd.core.LsdContext`.
 *
 * **Mirrored:** participants, facts, `capture` of messages / responses / notes /
 * logical dividers / lifelines, scenario completion, report + index writers.
 * Completing a report serialises [ReportJson] (the report-next shape) and injects
 * it into the interactive SVG shell.
 *
 * **Deferred:** PlantUML / component diagrams, legacy include-files, Newpage,
 * TimeDelay, VerticalSpace, NoteLeft/NoteRight, short inbound/outbound arrows.
 */
open class LsdContext {

    val idGenerator = IdGenerator(LsdProperties.deterministicIds())
    val outputDirectory: File = File(LsdProperties.outputDirectory())

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
        capture(Note(id = idGenerator.next(), text = text, over = over))
    }

    fun divider(label: String) {
        capture(Divider(id = idGenerator.next(), label = label))
    }

    fun activate(participant: String) {
        capture(Lifeline(id = idGenerator.next(), participantId = participant, action = LifelineAction.ACTIVATE))
    }

    fun deactivate(participant: String) {
        capture(Lifeline(id = idGenerator.next(), participantId = participant, action = LifelineAction.DEACTIVATE))
    }

    @JvmOverloads
    fun completeScenario(
        title: String,
        description: String? = "",
        status: Status = Status.SUCCESS,
    ) {
        val events = currentEvents.toList()
        scenarios.add(
            Scenario(
                title = title,
                description = description.orEmpty(),
                status = status,
                facts = currentFacts.toList(),
                participants = participantsFor(events),
                events = events,
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

    fun completeComponentsReport(title: String): Path =
        ReportWriter.writeComponentsStub(title, outputDirectory)

    fun createIndex(): Path = ReportWriter.writeIndex(reportFiles.toList(), outputDirectory)

    fun clear() {
        idGenerator.reset()
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
            is Message ->
                event.copy(
                    id = event.id.ifBlank { idGenerator.next() },
                    from = resolve(event.from).id,
                    to = resolve(event.to).id,
                )
            is Note ->
                event.copy(
                    id = event.id.ifBlank { idGenerator.next() },
                    over = resolve(event.over).id,
                )
            is Divider -> event.copy(id = event.id.ifBlank { idGenerator.next() })
            is Lifeline ->
                event.copy(
                    id = event.id.ifBlank { idGenerator.next() },
                    participantId = resolve(event.participantId).id,
                )
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
                    ids.add(event.from)
                    ids.add(event.to)
                }
                is Note -> ids.add(event.over)
                is Lifeline -> ids.add(event.participantId)
                is Divider -> Unit
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
            scenarios = scenarios.map { scenario -> scenario.toJsonModel() },
        )

    private fun Scenario.toJsonModel(): ScenarioJson {
        val messages = events.filterIsInstance<Message>()
        val duration = messages.mapNotNull { it.durationMs }.sum()
        val metrics =
            buildList {
                add(MetricJson("Messages", messages.size.toString()))
                if (duration > 0) add(MetricJson("Captured duration", "$duration ms"))
            }
        return ScenarioJson(
            id = idGenerator.next(),
            title = title,
            status = status.toReportStatus(),
            description = description,
            facts = facts.map { FactJson(it.key, it.value) },
            metrics = metrics,
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
                )
            is Note -> NoteEventJson(id = id, text = text, over = over)
            is Divider -> DividerEventJson(id = id, label = label)
            is Lifeline ->
                LifelineEventJson(
                    kind = if (action == LifelineAction.ACTIVATE) "activate" else "deactivate",
                    id = id,
                    participantId = participantId,
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
