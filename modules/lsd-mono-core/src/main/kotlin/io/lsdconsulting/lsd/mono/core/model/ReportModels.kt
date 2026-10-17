package io.lsdconsulting.lsd.mono.core.model

import io.lsdconsulting.lsd.mono.core.json.JsonArray
import io.lsdconsulting.lsd.mono.core.json.JsonBool
import io.lsdconsulting.lsd.mono.core.json.JsonNumber
import io.lsdconsulting.lsd.mono.core.json.JsonObject
import io.lsdconsulting.lsd.mono.core.json.JsonString
import io.lsdconsulting.lsd.mono.core.json.JsonValue
import io.lsdconsulting.lsd.mono.core.json.anyToJson
import io.lsdconsulting.lsd.mono.core.json.render

/**
 * Report JSON aligned with report `src/types.ts` (`Report` / `Scenario` / `DiagramEvent`).
 */
internal data class ReportFile(
    /** The page the index links to: the report's interactive diagram. */
    val filename: String,
    val title: String,
    val status: String,
    /** Scenarios by outcome. */
    val counts: ScenarioCounts = ScenarioCounts(),
    /** File-name stem shared by the report's files. Null for an entry that is only a link. */
    val stem: String? = null,
    /** `<stem>-report.js`: the report's data, for the index page to load when it is opened. */
    val dataScript: String? = null,
    /** The report's scenarios, in report order, so the index can list them before loading the data. */
    val scenarios: List<IndexScenario> = emptyList(),
)

/** One scenario as the index lists it. */
internal data class IndexScenario(
    val id: String,
    val title: String,
    val status: String,
    val messages: Int,
)

/** How many of a report's scenarios passed, warned and failed. */
internal data class ScenarioCounts(
    val success: Int = 0,
    val warn: Int = 0,
    val error: Int = 0,
) {
    val total: Int get() = success + warn + error

    operator fun plus(other: ScenarioCounts): ScenarioCounts =
        ScenarioCounts(success + other.success, warn + other.warn, error + other.error)

    companion object {
        fun of(statuses: List<String>): ScenarioCounts =
            ScenarioCounts(
                success = statuses.count { it == "success" },
                warn = statuses.count { it == "warn" },
                error = statuses.count { it == "error" },
            )
    }
}

internal data class ReportOptionsJson(
    /** When false, scenario `metrics` are empty. Default true. */
    val metricsEnabled: Boolean = true,
    /** Character width used to truncate labels in the shell and in metric summaries. */
    val labelMaxWidth: Int = 200,
)

internal data class ReportJson(
    val title: String,
    val generatedAt: String,
    val generator: String,
    /**
     * Worst scenario outcome: `error` > `warn` > `success`
     * (legacy ERROR > WARN > SUCCESS). `success` when there are no scenarios.
     */
    val status: String,
    val options: ReportOptionsJson = ReportOptionsJson(),
    val scenarios: List<ScenarioJson>,
)

internal data class ScenarioErrorJson(
    val headline: String,
    val message: String,
    val stack: String? = null,
)

internal data class ScenarioJson(
    val id: String,
    val title: String,
    val status: String,
    val description: String,
    val facts: List<FactJson>,
    val metrics: List<MetricJson> = emptyList(),
    val participants: List<ParticipantJson> = emptyList(),
    val events: List<EventJson> = emptyList(),
    /** Present for failed/aborted scenarios. Omitted from JSON when null. */
    val error: ScenarioErrorJson? = null,
    val timing: ScenarioTimingJson? = null,
)

/** Scenario-level timing: accuracy, coverage, sources and clock ordering. */
internal data class ScenarioTimingJson(
    val accuracy: String,
    val measuredCoverage: Double?,
    val pairingCoverage: Double?,
    val sources: List<String>,
    val wallClockMs: Double?,
    val clockOrdering: String,
    val clockOrdered: Int,
    val warnings: List<String>,
    val reorderedByClock: List<String>,
    val pairAccuracy: List<PairAccuracyJson> = emptyList(),
)

/** Accuracy of the messages between two participants. */
internal data class PairAccuracyJson(
    val from: String,
    val to: String,
    val accuracy: String,
)

/** Trace ids on a message. */
internal data class TraceJson(
    val traceId: String,
    val spanId: String?,
    val parentSpanId: String?,
)

/** Fractional milliseconds, to the microsecond, without trailing zeros. */
internal fun msNumber(ms: Double): JsonNumber =
    JsonNumber(
        java.math.BigDecimal
            .valueOf(ms)
            .setScale(3, java.math.RoundingMode.HALF_UP)
            .stripTrailingZeros()
            .toPlainString(),
    )

internal data class FactJson(
    val key: String,
    val value: String,
)

internal data class MetricJson(
    val key: String,
    val value: String,
)

internal data class ParticipantJson(
    val id: String,
    val name: String,
    val type: String = "PARTICIPANT",
    val alias: String? = null,
    val colour: String? = null,
)

internal sealed class EventJson {
    internal abstract fun toJsonValue(): JsonValue
}

internal data class MessageEventJson(
    val id: String,
    val from: String,
    val to: String,
    val label: String,
    val type: String,
    val colour: String? = null,
    /** Fractional ms. */
    val durationMs: Double? = null,
    val data: Any? = null,
    /** Set when [data] is only method/path/status and the rest lives in the payload sidecar. */
    val payloadId: String? = null,
    val startedAt: String? = null,
    val seq: Long? = null,
    val callId: String? = null,
    val replyTo: String? = null,
    val causedBy: String? = null,
    val trace: TraceJson? = null,
    val source: String? = null,
    val capturedAt: String? = null,
    val status: String? = null,
    val timing: String? = null,
    val pairing: String? = null,
    val order: String? = null,
    /** Id of the call this message runs inside. */
    val parentId: String? = null,
    /** On a paired reply: id of the call it answers. */
    val replyOf: String? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("message"))
                add("id" to JsonString(id))
                add("from" to JsonString(from))
                add("to" to JsonString(to))
                add("label" to JsonString(label))
                add("type" to JsonString(type))
                if (colour != null) add("colour" to JsonString(colour))
                if (durationMs != null) add("durationMs" to msNumber(durationMs))
                if (data != null) add("data" to anyToJson(data))
                if (payloadId != null) add("payloadId" to JsonString(payloadId))
                if (seq != null) add("seq" to JsonNumber(seq.toString()))
                if (callId != null) add("callId" to JsonString(callId))
                if (replyTo != null) add("replyTo" to JsonString(replyTo))
                if (causedBy != null) add("causedBy" to JsonString(causedBy))
                if (trace != null) {
                    add(
                        "trace" to
                            obj(
                                buildList {
                                    add("traceId" to JsonString(trace.traceId))
                                    if (trace.spanId != null) add("spanId" to JsonString(trace.spanId))
                                    if (trace.parentSpanId != null) add("parentSpanId" to JsonString(trace.parentSpanId))
                                },
                            ),
                    )
                }
                if (source != null) add("source" to JsonString(source))
                if (startedAt != null) add("startedAt" to JsonString(startedAt))
                if (capturedAt != null) add("capturedAt" to JsonString(capturedAt))
                if (status != null) add("status" to JsonString(status))
                if (timing != null) add("timing" to JsonString(timing))
                if (pairing != null) add("pairing" to JsonString(pairing))
                if (order != null) add("order" to JsonString(order))
                if (parentId != null) add("parentId" to JsonString(parentId))
                if (replyOf != null) add("replyOf" to JsonString(replyOf))
            },
        )
}

internal data class NoteEventJson(
    val id: String,
    val text: String,
    /** Anchor participant. Required for placement `over`; optional for left/right. */
    val over: String? = null,
    val placement: String = "over",
    val createdAt: String? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("note"))
                add("id" to JsonString(id))
                add("text" to JsonString(text))
                if (over != null) add("over" to JsonString(over))
                add("placement" to JsonString(placement))
                if (createdAt != null) add("createdAt" to JsonString(createdAt))
            },
        )
}

internal data class DelayEventJson(
    val id: String,
    val label: String? = null,
    val createdAt: String? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("delay"))
                add("id" to JsonString(id))
                if (label != null) add("label" to JsonString(label))
                if (createdAt != null) add("createdAt" to JsonString(createdAt))
            },
        )
}

internal data class SpacerEventJson(
    val id: String,
    val heightPx: Int? = null,
    val createdAt: String? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("spacer"))
                add("id" to JsonString(id))
                if (heightPx != null) add("heightPx" to JsonNumber(heightPx.toString()))
                if (createdAt != null) add("createdAt" to JsonString(createdAt))
            },
        )
}

internal data class DividerEventJson(
    val id: String,
    val label: String,
    val createdAt: String? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("divider"))
                add("id" to JsonString(id))
                add("label" to JsonString(label))
                if (createdAt != null) add("createdAt" to JsonString(createdAt))
            },
        )
}

internal data class SectionEventJson(
    val id: String,
    val title: String,
    val createdAt: String? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("section"))
                add("id" to JsonString(id))
                add("title" to JsonString(title))
                if (createdAt != null) add("createdAt" to JsonString(createdAt))
            },
        )
}

internal data class LifelineEventJson(
    val kind: String,
    val id: String,
    val participantId: String,
    /** Present only on activate, and only when the caller set a colour. */
    val colour: String? = null,
    val createdAt: String? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString(kind))
                add("id" to JsonString(id))
                add("participantId" to JsonString(participantId))
                if (colour != null) add("colour" to JsonString(colour))
                if (createdAt != null) add("createdAt" to JsonString(createdAt))
            },
        )
}

internal fun ReportJson.toJson(): String =
    obj(
        listOf(
            "title" to JsonString(title),
            "generatedAt" to JsonString(generatedAt),
            "generator" to JsonString(generator),
            "status" to JsonString(status),
            "options" to options.toJsonValue(),
            "scenarios" to JsonArray(scenarios.map { it.toJsonValue() }),
        ),
    ).render() + "\n"

private fun ScenarioJson.toJsonValue(): JsonValue =
    obj(
        buildList {
            add("id" to JsonString(id))
            add("title" to JsonString(title))
            add("status" to JsonString(status))
            add("description" to JsonString(description))
            if (error != null) add("error" to error.toJsonValue())
            add("facts" to JsonArray(facts.map { obj(listOf("key" to JsonString(it.key), "value" to JsonString(it.value))) }))
            add("metrics" to JsonArray(metrics.map { obj(listOf("key" to JsonString(it.key), "value" to JsonString(it.value))) }))
            add("participants" to JsonArray(participants.map { it.toJsonValue() }))
            add("events" to JsonArray(events.map { it.toJsonValue() }))
            if (timing != null) {
                add("accuracy" to JsonString(timing.accuracy))
                if (timing.measuredCoverage != null) add("measuredCoverage" to msNumber(timing.measuredCoverage))
                if (timing.pairingCoverage != null) add("pairingCoverage" to msNumber(timing.pairingCoverage))
                add("sources" to JsonArray(timing.sources.map(::JsonString)))
                if (timing.wallClockMs != null) add("wallClockMs" to msNumber(timing.wallClockMs))
                add("clockOrdering" to JsonString(timing.clockOrdering))
                add("clockOrdered" to JsonNumber(timing.clockOrdered.toString()))
                if (timing.warnings.isNotEmpty()) add("warnings" to JsonArray(timing.warnings.map(::JsonString)))
                if (timing.reorderedByClock.isNotEmpty()) {
                    add("reorderedByClock" to JsonArray(timing.reorderedByClock.map(::JsonString)))
                }
                if (timing.pairAccuracy.isNotEmpty()) {
                    add(
                        "pairAccuracy" to
                            JsonArray(
                                timing.pairAccuracy.map {
                                    obj(listOf("from" to JsonString(it.from), "to" to JsonString(it.to), "accuracy" to JsonString(it.accuracy)))
                                },
                            ),
                    )
                }
            }
        },
    )

private fun ScenarioErrorJson.toJsonValue(): JsonValue =
    obj(
        buildList {
            add("headline" to JsonString(headline))
            add("message" to JsonString(message))
            if (stack != null) add("stack" to JsonString(stack))
        },
    )

private fun ReportOptionsJson.toJsonValue(): JsonValue =
    obj(
        listOf(
            "metricsEnabled" to JsonBool(metricsEnabled),
            "labelMaxWidth" to JsonNumber(labelMaxWidth.toString()),
        ),
    )

private fun ParticipantJson.toJsonValue(): JsonValue =
    obj(
        buildList {
            add("id" to JsonString(id))
            add("name" to JsonString(name))
            add("type" to JsonString(type))
            if (alias != null) add("alias" to JsonString(alias))
            if (colour != null) add("colour" to JsonString(colour))
        },
    )

private fun obj(fields: List<Pair<String, JsonValue>>): JsonObject = JsonObject(fields)

/**
 * Report injected into the HTML shell. Method, path, and status stay on the message.
 * Any other payload field is removed from this copy and returned for the sidecar script.
 * [ReportJson.toJson] is unchanged so `report.json` still has the full capture.
 */
internal fun ReportJson.forShell(): ShellReport {
    val payloads = linkedMapOf<String, Any?>()
    val light =
        copy(
            scenarios =
                scenarios.map { scenario ->
                    scenario.copy(
                        events =
                            scenario.events.map { event ->
                                if (event !is MessageEventJson)
                                    event
                                else
                                    splitMessageForShell(scenario.id, event, payloads)
                            },
                    )
                },
        )
    return ShellReport(light, payloads)
}

internal data class ShellReport(
    val report: ReportJson,
    val payloads: Map<String, Any?>,
)

private fun splitMessageForShell(
    scenarioId: String,
    event: MessageEventJson,
    payloads: MutableMap<String, Any?>,
): MessageEventJson {
    val data = event.data ?: return event
    val split = splitPayload(data)
    if (!split.defer) return event
    val id = "$scenarioId/${event.id}"
    payloads[id] = data
    return event.copy(data = split.summary, payloadId = id)
}

private data class PayloadSplit(val summary: Map<String, Any?>?, val defer: Boolean)

private fun splitPayload(data: Any?): PayloadSplit {
    if (data !is Map<*, *>) return PayloadSplit(summary = null, defer = true)
    val summary = linkedMapOf<String, Any?>()
    var defer = false
    for ((key, value) in data) {
        val name = key?.toString() ?: continue
        if (isSummaryField(name, value))
            summary[name] = value
        else
            defer = true
    }
    if (!defer) return PayloadSplit(summary = null, defer = false)
    return PayloadSplit(summary = summary.takeIf { it.isNotEmpty() }, defer = true)
}

private fun isSummaryField(name: String, value: Any?): Boolean =
    when (name) {
        "method", "path" -> value is String && value.isNotEmpty()
        "status" -> (value is String && value.isNotEmpty()) || value is Number
        else -> false
    }

/** One entry per deferred payload. The outer map is not subject to the payload item limit. */
internal fun shellPayloadScript(payloads: Map<String, Any?>): String =
    "window.__LSD_PAYLOADS__=${JsonObject(payloads.map { (id, data) -> id to anyToJson(data) }).render()};\n"
