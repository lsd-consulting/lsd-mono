package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.LsdVersion
import io.lsdconsulting.lsd.mono.core.ReportOptions
import io.lsdconsulting.lsd.mono.core.domain.Delay
import io.lsdconsulting.lsd.mono.core.domain.Divider
import io.lsdconsulting.lsd.mono.core.domain.Lifeline
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.Scenario
import io.lsdconsulting.lsd.mono.core.domain.ScenarioTiming
import io.lsdconsulting.lsd.mono.core.domain.Section
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.Spacer
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.model.DelayEventJson
import io.lsdconsulting.lsd.mono.core.model.DividerEventJson
import io.lsdconsulting.lsd.mono.core.model.EventJson
import io.lsdconsulting.lsd.mono.core.model.FactJson
import io.lsdconsulting.lsd.mono.core.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.core.model.MessageEventJson
import io.lsdconsulting.lsd.mono.core.model.NoteEventJson
import io.lsdconsulting.lsd.mono.core.model.PairAccuracyJson
import io.lsdconsulting.lsd.mono.core.model.ParticipantJson
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ReportOptionsJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioErrorJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioTimingJson
import io.lsdconsulting.lsd.mono.core.model.SectionEventJson
import io.lsdconsulting.lsd.mono.core.model.SpacerEventJson
import io.lsdconsulting.lsd.mono.core.model.TraceJson
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Maps completed [Scenario]s to the report shape, [ReportJson]. [nextId] gives each scenario its
 * id. Report options are read once per report.
 */
internal class ReportJsonMapper(private val nextId: () -> String) {
    fun toReportJson(title: String, scenarios: List<Scenario>): ReportJson {
        val options = ReportOptions.fromProperties()
        return ReportJson(
            title = title,
            // UTC instant. The report page shows it in the reader's own time zone.
            // lsd.mono.report.generatedAt fixes it, for reproducible samples.
            generatedAt = (LsdProperties.generatedAt() ?: Instant.now()).truncatedTo(ChronoUnit.MILLIS).toString(),
            generator = LsdVersion.generator,
            status = determineOverallStatus(scenarios),
            options = options.toJson(),
            scenarios = scenarios.map { scenario -> scenario.toJsonModel(options) },
        )
    }

    private fun ReportOptions.toJson(): ReportOptionsJson =
        ReportOptionsJson(metricsEnabled = metricsEnabled, labelMaxWidth = labelMaxWidth)

    private fun Scenario.toJsonModel(options: ReportOptions): ScenarioJson = ScenarioJson(
        id = nextId(),
        title = title,
        status = status.toReportStatus(),
        description = description,
        facts = facts.map { FactJson(it.key, it.value) },
        error = error?.let { ScenarioErrorJson(it.headline, it.message, it.stack) },
        metrics = capturedMetrics(events, timing, options),
        participants =
            participants.map {
                ParticipantJson(
                    id = it.id,
                    name = it.name,
                    type = it.type.name,
                    alias = it.displayName,
                    colour = it.colour,
                )
            },
        events = events.map { it.toEventJson(timing) },
        timing =
            ScenarioTimingJson(
                accuracy = timing.accuracy.name,
                measuredCoverage = timing.measuredCoverage,
                pairingCoverage = timing.pairingCoverage,
                sources = timing.sources,
                wallClockMs = timing.wallClockMs,
                clockOrdering = timing.clockOrdering.name,
                clockOrdered = timing.clockOrdered,
                warnings = timing.warnings,
                reorderedByClock = timing.reorderedByClock,
                pairAccuracy = timing.pairAccuracy.map { PairAccuracyJson(it.from, it.to, it.accuracy.name) },
            ),
    )

    /** `capturedAt` is a wall-clock hint; reproducible reports leave it out. */
    private val writeCapturedAt: Boolean
        get() = LsdProperties.generatedAt() == null && !LsdProperties.deterministicIds()

    private fun SequenceEvent.toEventJson(timing: ScenarioTiming): EventJson =
        when (this) {
            is Message ->
                MessageEventJson(
                    id = id,
                    // The JSON draws a diagram-edge end as "".
                    from = from.orEmpty(),
                    to = to.orEmpty(),
                    label = label,
                    type = type.name,
                    colour = colour?.takeIf { it.isNotBlank() },
                    durationMs = timing.reportedMs(this),
                    data = data,
                    startedAt = createdAt?.toString(),
                    seq = seq.takeIf { it > 0 },
                    callId = callRef?.id,
                    replyTo = replyTo?.id,
                    causedBy = causedBy?.id,
                    trace = trace?.let { TraceJson(it.traceId, it.spanId, it.parentSpanId) },
                    source = source,
                    capturedAt = capturedAt?.takeIf { writeCapturedAt }?.toString(),
                    status = status,
                    timing = timing.perEvent[id]?.timing?.name,
                    pairing = timing.perEvent[id]?.pairing?.name,
                    order = timing.perEvent[id]?.order?.name,
                    parentId = timing.parentOf[id],
                    replyOf = timing.replyOf[id],
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
                        Status.WARN -> 1
                        Status.SUCCESS -> 2
                    }
                },
            ).firstOrNull()
            ?.toCssClass()
            ?: "success"
}
