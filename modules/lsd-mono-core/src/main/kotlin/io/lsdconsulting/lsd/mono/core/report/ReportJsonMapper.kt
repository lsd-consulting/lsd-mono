package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.LsdVersion
import io.lsdconsulting.lsd.mono.core.PayloadConverters
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
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.report.model.AccuracyJson
import io.lsdconsulting.lsd.mono.report.model.ClockOrderingJson
import io.lsdconsulting.lsd.mono.report.model.DelayEventJson
import io.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.lsdconsulting.lsd.mono.report.model.EventJson
import io.lsdconsulting.lsd.mono.report.model.FactJson
import io.lsdconsulting.lsd.mono.report.model.KnownReportSource
import io.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.report.model.LifelineKindJson
import io.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.lsdconsulting.lsd.mono.report.model.NotePlacementJson
import io.lsdconsulting.lsd.mono.report.model.PairAccuracyJson
import io.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.lsdconsulting.lsd.mono.report.model.ReportJson
import io.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import io.lsdconsulting.lsd.mono.report.model.ScenarioErrorJson
import io.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.lsdconsulting.lsd.mono.report.model.SpacerEventJson
import io.lsdconsulting.lsd.mono.report.model.StatusJson
import io.lsdconsulting.lsd.mono.report.model.TraceJson
import io.lsdconsulting.lsd.mono.report.model.WarningJson
import java.math.BigDecimal
import java.math.BigInteger
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Maps completed [Scenario]s to the report shape, [ReportJson]. [nextId] gives each scenario its
 * id. Report options are read once per report.
 */
internal class ReportJsonMapper(private val nextId: () -> String) {
    fun toReportJson(title: String, scenarios: List<Scenario>, source: String = KnownReportSource.API): ReportJson {
        val options = ReportOptions.fromProperties()
        return ReportJson(
            title = title,
            // UTC instant. The report page shows it in the reader's own time zone.
            // lsd.mono.report.generatedAt fixes it, for reproducible samples.
            generatedAt = (LsdProperties.generatedAt() ?: Instant.now()).truncatedTo(ChronoUnit.MILLIS).toString(),
            generator = LsdVersion.generator,
            status = determineOverallStatus(scenarios),
            options = options.toJson(source),
            scenarios = scenarios.map { scenario -> scenario.toJsonModel(options) },
        )
    }

    private fun ReportOptions.toJson(source: String): ReportOptionsJson =
        ReportOptionsJson(
            metricsEnabled = metricsEnabled,
            labelMaxWidth = labelMaxWidth,
            usagePing = usagePing,
            source = knownSource(source),
        )

    private fun Scenario.toJsonModel(options: ReportOptions): ScenarioJson = ScenarioJson(
        id = nextId(),
        title = title,
        status = status.toJson(),
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
        accuracy = AccuracyJson.valueOf(timing.accuracy.name),
        measuredCoverage = timing.measuredCoverage,
        pairingCoverage = timing.pairingCoverage,
        sources = timing.sources,
        wallClockMs = timing.wallClockMs,
        clockOrdering = ClockOrderingJson.valueOf(timing.clockOrdering.name),
        clockOrdered = timing.clockOrdered,
        warnings = timing.warnings.map { WarningJson(it.kind.name, it.message) },
        reorderedByClock = timing.reorderedByClock,
        pairAccuracy = timing.pairAccuracy.map { PairAccuracyJson(it.from, it.to, AccuracyJson.valueOf(it.accuracy.name)) },
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
                    data = data?.let(::jsonData),
                    startedAt = startedAt?.toString(),
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
                    placement = NotePlacementJson.valueOf(placement.name),
                    startedAt = startedAt?.toString(),
                )
            is Divider -> DividerEventJson(id = id, label = label, startedAt = startedAt?.toString())
            is Section -> SectionEventJson(id = id, title = title, startedAt = startedAt?.toString())
            is Delay -> DelayEventJson(id = id, label = label, startedAt = startedAt?.toString())
            is Spacer -> SpacerEventJson(id = id, heightPx = heightPx, startedAt = startedAt?.toString())
            is Lifeline ->
                LifelineEventJson(
                    kind = if (action == LifelineAction.ACTIVATE) LifelineKindJson.ACTIVATE else LifelineKindJson.DEACTIVATE,
                    id = id,
                    participantId = participantId,
                    colour = if (action == LifelineAction.ACTIVATE) colour?.takeIf { it.isNotBlank() } else null,
                    startedAt = startedAt?.toString(),
                )
        }

    /**
     * [data] as JSON values for the model: a scalar as it is, anything else copied by the default
     * payload converters, as the JSON writer did before it moved to lsd-mono-report-html.
     */
    private fun jsonData(data: Any): Any? =
        when (data) {
            is String, is Boolean, is Long, is BigInteger, is BigDecimal -> data
            else -> PayloadConverters.default.snapshot(data)
        }

    /** [name] when it is one of [KnownReportSource.ALL], else [KnownReportSource.API]. */
    private fun knownSource(name: String?): String = name?.takeIf { it in KnownReportSource.ALL } ?: KnownReportSource.API

    private fun Status.toJson(): StatusJson =
        when (this) {
            Status.SUCCESS -> StatusJson.SUCCESS
            Status.WARN -> StatusJson.WARN
            Status.ERROR -> StatusJson.ERROR
        }

    private fun determineOverallStatus(scenarios: List<Scenario>): StatusJson =
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
            ?.toJson()
            ?: StatusJson.SUCCESS
}
