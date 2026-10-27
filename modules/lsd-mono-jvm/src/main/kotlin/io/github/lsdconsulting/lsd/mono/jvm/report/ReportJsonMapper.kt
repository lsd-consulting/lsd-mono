package io.github.lsdconsulting.lsd.mono.jvm.report

import io.github.lsdconsulting.lsd.mono.jvm.LsdVersion
import io.github.lsdconsulting.lsd.mono.jvm.PayloadConverters
import io.github.lsdconsulting.lsd.mono.jvm.ReportOptions
import io.github.lsdconsulting.lsd.mono.jvm.domain.Delay
import io.github.lsdconsulting.lsd.mono.jvm.domain.Divider
import io.github.lsdconsulting.lsd.mono.jvm.domain.Lifeline
import io.github.lsdconsulting.lsd.mono.jvm.domain.LifelineAction
import io.github.lsdconsulting.lsd.mono.jvm.domain.Message
import io.github.lsdconsulting.lsd.mono.jvm.domain.Note
import io.github.lsdconsulting.lsd.mono.jvm.domain.Scenario
import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioTiming
import io.github.lsdconsulting.lsd.mono.jvm.domain.Section
import io.github.lsdconsulting.lsd.mono.jvm.domain.SequenceEvent
import io.github.lsdconsulting.lsd.mono.jvm.domain.Spacer
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.report.model.AccuracyJson
import io.github.lsdconsulting.lsd.mono.report.model.ClockOrderingJson
import io.github.lsdconsulting.lsd.mono.report.model.DataValueJson
import io.github.lsdconsulting.lsd.mono.report.model.DelayEventJson
import io.github.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.github.lsdconsulting.lsd.mono.report.model.EventJson
import io.github.lsdconsulting.lsd.mono.report.model.FactJson
import io.github.lsdconsulting.lsd.mono.report.model.KnownReportSource
import io.github.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.github.lsdconsulting.lsd.mono.report.model.LifelineKindJson
import io.github.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.github.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.github.lsdconsulting.lsd.mono.report.model.NotePlacementJson
import io.github.lsdconsulting.lsd.mono.report.model.PairAccuracyJson
import io.github.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioErrorJson
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.github.lsdconsulting.lsd.mono.report.model.SpacerEventJson
import io.github.lsdconsulting.lsd.mono.report.model.StatusJson
import io.github.lsdconsulting.lsd.mono.report.model.TraceJson
import io.github.lsdconsulting.lsd.mono.report.model.WarningJson
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
        return ReportJson
            .builder(
                title = title,
                // UTC instant. The report page shows it in the reader's own time zone.
                // lsd.mono.report.generatedAt fixes it, for reproducible samples.
                generatedAt = (LsdProperties.generatedAt() ?: Instant.now()).truncatedTo(ChronoUnit.MILLIS).toString(),
                generator = LsdVersion.generator,
                status = determineOverallStatus(scenarios),
            ).options(options.toJson(source))
            .scenarios(scenarios.map { scenario -> scenario.toJsonModel(options) })
            .build()
    }

    private fun ReportOptions.toJson(source: String): ReportOptionsJson =
        ReportOptionsJson
            .builder()
            .metricsEnabled(metricsEnabled)
            .labelMaxWidth(labelMaxWidth)
            .usagePing(usagePing)
            .source(knownSource(source))
            .build()

    private fun Scenario.toJsonModel(options: ReportOptions): ScenarioJson =
        ScenarioJson
            .builder(id = nextId(), title = title, status = status.toJson())
            .description(description)
            .facts(facts.map { FactJson(it.key, it.value) })
            .error(error?.let { ScenarioErrorJson.builder(it.headline, it.message).stack(it.stack).build() })
            .metrics(capturedMetrics(events, timing, options))
            .participants(
                participants.map {
                    ParticipantJson
                        .builder(id = it.id, name = it.name)
                        .type(it.type.name)
                        .alias(it.displayName)
                        .colour(it.colour)
                        .build()
                },
            ).events(events.map { it.toEventJson(timing) })
            .accuracy(AccuracyJson.valueOf(timing.accuracy.name))
            .measuredCoverage(timing.measuredCoverage)
            .pairingCoverage(timing.pairingCoverage)
            .sources(timing.sources)
            .wallClockMs(timing.wallClockMs)
            .clockOrdering(ClockOrderingJson.valueOf(timing.clockOrdering.name))
            .clockOrdered(timing.clockOrdered)
            .warnings(timing.warnings.map { WarningJson(it.kind.name, it.message) })
            .reorderedByClock(timing.reorderedByClock)
            .pairAccuracy(timing.pairAccuracy.map { PairAccuracyJson(it.from, it.to, AccuracyJson.valueOf(it.accuracy.name)) })
            .build()

    /** `capturedAt` is a wall-clock hint; reproducible reports leave it out. */
    private val writeCapturedAt: Boolean
        get() = LsdProperties.generatedAt() == null && !LsdProperties.deterministicIds()

    private fun SequenceEvent.toEventJson(timing: ScenarioTiming): EventJson =
        when (this) {
            is Message ->
                MessageEventJson
                    // The JSON draws a diagram-edge end as "".
                    .builder(id = id, from = from.orEmpty(), to = to.orEmpty(), label = label, type = type.name)
                    .colour(colour?.takeIf { it.isNotBlank() })
                    .durationMs(timing.reportedMs(this))
                    .data(data?.let(::jsonData))
                    .startedAt(startedAt?.toString())
                    .seq(seq.takeIf { it > 0 })
                    .callId(callRef?.id)
                    .replyTo(replyTo?.id)
                    .causedBy(causedBy?.id)
                    .trace(trace?.let { TraceJson(it.traceId, it.spanId, it.parentSpanId) })
                    .source(source)
                    .capturedAt(capturedAt?.takeIf { writeCapturedAt }?.toString())
                    .status(status)
                    .timing(timing.perEvent[id]?.timing?.name)
                    .pairing(timing.perEvent[id]?.pairing?.name)
                    .order(timing.perEvent[id]?.order?.name)
                    .parentId(timing.parentOf[id])
                    .replyOf(timing.replyOf[id])
                    .build()
            is Note ->
                NoteEventJson
                    .builder(id = id, text = text)
                    .over(over)
                    .placement(NotePlacementJson.valueOf(placement.name))
                    .startedAt(startedAt?.toString())
                    .build()
            is Divider -> DividerEventJson.builder(id = id, label = label).startedAt(startedAt?.toString()).build()
            is Section -> SectionEventJson.builder(id = id, title = title).startedAt(startedAt?.toString()).build()
            is Delay ->
                DelayEventJson
                    .builder(id = id)
                    .label(label)
                    .startedAt(startedAt?.toString())
                    .build()
            is Spacer ->
                SpacerEventJson
                    .builder(id = id)
                    .heightPx(heightPx)
                    .startedAt(startedAt?.toString())
                    .build()
            is Lifeline ->
                LifelineEventJson
                    .builder(
                        kind = if (action == LifelineAction.ACTIVATE) LifelineKindJson.ACTIVATE else LifelineKindJson.DEACTIVATE,
                        id = id,
                        participantId = participantId,
                    ).colour(if (action == LifelineAction.ACTIVATE) colour?.takeIf { it.isNotBlank() } else null)
                    .startedAt(startedAt?.toString())
                    .build()
        }

    /**
     * [data] as the model's JSON value: a scalar as it is, anything else copied by the default
     * payload converters, as the JSON writer did before it moved to lsd-mono-report-html. Null
     * (a payload that copies to nothing) is no data, not JSON `null`.
     */
    private fun jsonData(data: Any): DataValueJson? =
        when (data) {
            is String, is Boolean, is Long, is BigInteger, is BigDecimal -> DataValueJson.from(data)
            else -> PayloadConverters.default.snapshot(data)?.let(DataValueJson::from)
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
