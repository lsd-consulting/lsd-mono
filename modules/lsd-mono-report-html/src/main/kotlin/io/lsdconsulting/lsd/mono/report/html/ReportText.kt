package io.lsdconsulting.lsd.mono.report.html

import io.lsdconsulting.lsd.mono.report.model.DelayEventJson
import io.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.lsdconsulting.lsd.mono.report.model.EventJson
import io.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.lsdconsulting.lsd.mono.report.model.ReportJson
import io.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import io.lsdconsulting.lsd.mono.report.model.ReportSchema
import io.lsdconsulting.lsd.mono.report.model.ScenarioErrorJson
import io.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.lsdconsulting.lsd.mono.report.model.SpacerEventJson
import java.math.BigDecimal
import java.math.RoundingMode

/*
 * The report JSON as text, and the index entries. The report itself is lsd-mono-report-model's
 * ReportJson, as the schema (`modules/lsd-mono-report-schema/lsd-report.schema.json`) describes it.
 */

/** A report as the index lists it. */
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

/**
 * Fractional milliseconds, to the microsecond, without trailing zeros: `42`, `17.625`, `0.333`, as
 * the schema has them. lsd-mono-core formats the milliseconds in its metrics and warnings the same way.
 */
internal fun msNumber(ms: Double): JsonNumber =
    JsonNumber(
        BigDecimal
            .valueOf(ms)
            .setScale(3, RoundingMode.HALF_UP)
            .stripTrailingZeros()
            .toPlainString(),
    )

internal fun ReportJson.toJson(): String =
    obj(
        listOf(
            "schemaVersion" to JsonString(ReportSchema.VERSION),
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
            error?.let { add("error" to it.toJsonValue()) }
            add("facts" to JsonArray(facts.map { obj(listOf("key" to JsonString(it.key), "value" to JsonString(it.value))) }))
            add("metrics" to JsonArray(metrics.map { obj(listOf("key" to JsonString(it.key), "value" to JsonString(it.value))) }))
            add("participants" to JsonArray(participants.map { it.toJsonValue() }))
            add("events" to JsonArray(events.map { it.toJsonValue() }))
            val summary = timing
            if (summary != null) {
                add("accuracy" to JsonString(summary.accuracy))
                summary.measuredCoverage?.let { add("measuredCoverage" to msNumber(it)) }
                summary.pairingCoverage?.let { add("pairingCoverage" to msNumber(it)) }
                add("sources" to JsonArray(summary.sources.map(::JsonString)))
                summary.wallClockMs?.let { add("wallClockMs" to msNumber(it)) }
                add("clockOrdering" to JsonString(summary.clockOrdering))
                add("clockOrdered" to JsonNumber(summary.clockOrdered.toString()))
                if (summary.warnings.isNotEmpty()) {
                    add(
                        "warnings" to
                            JsonArray(summary.warnings.map { obj(listOf("kind" to JsonString(it.kind), "message" to JsonString(it.message))) }),
                    )
                }
                if (summary.reorderedByClock.isNotEmpty()) {
                    add("reorderedByClock" to JsonArray(summary.reorderedByClock.map(::JsonString)))
                }
                if (summary.pairAccuracy.isNotEmpty()) {
                    add(
                        "pairAccuracy" to
                            JsonArray(
                                summary.pairAccuracy.map {
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
            stack?.let { add("stack" to JsonString(it)) }
        },
    )

private fun ReportOptionsJson.toJsonValue(): JsonValue =
    obj(
        listOf(
            "metricsEnabled" to JsonBool(metricsEnabled),
            "labelMaxWidth" to JsonNumber(labelMaxWidth.toString()),
            "usagePing" to JsonBool(usagePing),
            "source" to JsonString(source),
        ),
    )

private fun ParticipantJson.toJsonValue(): JsonValue =
    obj(
        buildList {
            add("id" to JsonString(id))
            add("name" to JsonString(name))
            add("type" to JsonString(type))
            alias?.let { add("alias" to JsonString(it)) }
            colour?.let { add("colour" to JsonString(it)) }
        },
    )

/** The JSON for one event, as the schema's `DiagramEvent` describes it. */
internal fun EventJson.toJsonValue(): JsonValue =
    when (this) {
        is MessageEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString("message"))
                    add("id" to JsonString(id))
                    add("from" to JsonString(from))
                    add("to" to JsonString(to))
                    add("label" to JsonString(label))
                    add("type" to JsonString(type))
                    colour?.let { add("colour" to JsonString(it)) }
                    durationMs?.let { add("durationMs" to msNumber(it)) }
                    data?.let { add("data" to anyToJson(it)) }
                    payloadId?.let { add("payloadId" to JsonString(it)) }
                    seq?.let { add("seq" to JsonNumber(it.toString())) }
                    callId?.let { add("callId" to JsonString(it)) }
                    replyTo?.let { add("replyTo" to JsonString(it)) }
                    causedBy?.let { add("causedBy" to JsonString(it)) }
                    val ids = trace
                    if (ids != null) {
                        add(
                            "trace" to
                                obj(
                                    buildList {
                                        add("traceId" to JsonString(ids.traceId))
                                        ids.spanId?.let { add("spanId" to JsonString(it)) }
                                        ids.parentSpanId?.let { add("parentSpanId" to JsonString(it)) }
                                    },
                                ),
                        )
                    }
                    source?.let { add("source" to JsonString(it)) }
                    startedAt?.let { add("startedAt" to JsonString(it)) }
                    capturedAt?.let { add("capturedAt" to JsonString(it)) }
                    status?.let { add("status" to JsonString(it)) }
                    timing?.let { add("timing" to JsonString(it)) }
                    pairing?.let { add("pairing" to JsonString(it)) }
                    order?.let { add("order" to JsonString(it)) }
                    parentId?.let { add("parentId" to JsonString(it)) }
                    replyOf?.let { add("replyOf" to JsonString(it)) }
                },
            )
        is NoteEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString("note"))
                    add("id" to JsonString(id))
                    add("text" to JsonString(text))
                    over?.let { add("over" to JsonString(it)) }
                    add("placement" to JsonString(placement))
                    startedAt?.let { add("startedAt" to JsonString(it)) }
                },
            )
        is DelayEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString("delay"))
                    add("id" to JsonString(id))
                    label?.let { add("label" to JsonString(it)) }
                    startedAt?.let { add("startedAt" to JsonString(it)) }
                },
            )
        is SpacerEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString("spacer"))
                    add("id" to JsonString(id))
                    heightPx?.let { add("heightPx" to JsonNumber(it.toString())) }
                    startedAt?.let { add("startedAt" to JsonString(it)) }
                },
            )
        is DividerEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString("divider"))
                    add("id" to JsonString(id))
                    add("label" to JsonString(label))
                    startedAt?.let { add("startedAt" to JsonString(it)) }
                },
            )
        is SectionEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString("section"))
                    add("id" to JsonString(id))
                    add("title" to JsonString(title))
                    startedAt?.let { add("startedAt" to JsonString(it)) }
                },
            )
        is LifelineEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString(kind))
                    add("id" to JsonString(id))
                    add("participantId" to JsonString(participantId))
                    colour?.let { add("colour" to JsonString(it)) }
                    startedAt?.let { add("startedAt" to JsonString(it)) }
                },
            )
    }

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

/**
 * One entry per deferred payload, each as its compact JSON text: the shell parses a payload only
 * when it is opened or searched, not every body when the script loads (#63). The outer map is not
 * subject to the payload item limit.
 */
internal fun shellPayloadScript(payloads: Map<String, Any?>): String =
    "window.__LSD_PAYLOAD_TEXT__=${JsonObject(payloads.map { (id, data) -> id to JsonString(anyToJson(data).renderCompact()) }).render()};\n"
