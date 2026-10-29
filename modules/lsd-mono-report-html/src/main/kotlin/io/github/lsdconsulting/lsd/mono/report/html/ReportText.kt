package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.AttributeValueJson
import io.github.lsdconsulting.lsd.mono.report.model.DataValueJson
import io.github.lsdconsulting.lsd.mono.report.model.DelayEventJson
import io.github.lsdconsulting.lsd.mono.report.model.DividerEventJson
import io.github.lsdconsulting.lsd.mono.report.model.EventJson
import io.github.lsdconsulting.lsd.mono.report.model.GeneratorJson
import io.github.lsdconsulting.lsd.mono.report.model.LifelineEventJson
import io.github.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.github.lsdconsulting.lsd.mono.report.model.NoteEventJson
import io.github.lsdconsulting.lsd.mono.report.model.ParticipantJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportSchema
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioErrorJson
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.SectionEventJson
import io.github.lsdconsulting.lsd.mono.report.model.SpacerEventJson
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
    val messageCount: Int,
)

/** How many of a report's scenarios had each outcome. */
internal data class ScenarioCounts(
    val success: Int = 0,
    val warn: Int = 0,
    val error: Int = 0,
    val skipped: Int = 0,
    val aborted: Int = 0,
) {
    val total: Int get() = success + warn + error + skipped + aborted

    operator fun plus(other: ScenarioCounts): ScenarioCounts =
        ScenarioCounts(
            success + other.success,
            warn + other.warn,
            error + other.error,
            skipped + other.skipped,
            aborted + other.aborted,
        )

    /** Each count by its status, in the order the index writes them. */
    fun byStatus(): List<Pair<String, Int>> =
        listOf("success" to success, "warn" to warn, "error" to error, "skipped" to skipped, "aborted" to aborted)

    companion object {
        fun of(statuses: List<String>): ScenarioCounts =
            ScenarioCounts(
                success = statuses.count { it == "success" },
                warn = statuses.count { it == "warn" },
                error = statuses.count { it == "error" },
                skipped = statuses.count { it == "skipped" },
                aborted = statuses.count { it == "aborted" },
            )
    }
}

/**
 * Fractional milliseconds, to the microsecond, without trailing zeros: `42`, `17.625`, `0.333`, as
 * the schema has them. lsd-mono-jvm formats the milliseconds in its metrics and warnings the same way.
 */
internal fun msNumber(ms: Double): JsonNumber =
    JsonNumber(
        BigDecimal
            .valueOf(ms)
            .setScale(3, RoundingMode.HALF_UP)
            .stripTrailingZeros()
            .toPlainString(),
    )

/** The `generator` object: its name, and its version when it has one. */
internal fun GeneratorJson.toJsonValue(): JsonValue =
    obj(
        buildList {
            add("name" to JsonString(name))
            version?.let { add("version" to JsonString(it)) }
        },
    )

/**
 * The report's JSON. Nothing is written empty: an empty list, object or optional string is left
 * out, as the schema says. [payloadIds] are the `<scenarioId>/<messageId>` keys of the payloads the
 * diagram page's copy loads on open: their messages get a `payloadId`, which is not part of the
 * format and never in `<stem>-report.json`.
 */
internal fun ReportJson.toJson(payloadIds: Set<String> = emptySet()): String =
    obj(
        buildList {
            add("schemaVersion" to JsonString(ReportSchema.VERSION))
            add("title" to JsonString(title))
            add("generatedAt" to JsonString(generatedAt))
            add("generator" to generator.toJsonValue())
            add("status" to JsonString(status.json))
            add("options" to options.toJsonValue())
            if (scenarios.isNotEmpty()) add("scenarios" to JsonArray(scenarios.map { it.toJsonValue(payloadIds) }))
        },
    ).render() + "\n"

private fun ScenarioJson.toJsonValue(payloadIds: Set<String>): JsonValue =
    obj(
        buildList {
            add("id" to JsonString(id))
            add("title" to JsonString(title))
            add("status" to JsonString(status.json))
            if (description.isNotEmpty()) add("description" to JsonString(description))
            error?.let { add("error" to it.toJsonValue()) }
            if (facts.isNotEmpty()) {
                add("facts" to JsonArray(facts.map { obj(listOf("key" to JsonString(it.key), "value" to JsonString(it.value))) }))
            }
            if (metrics.isNotEmpty()) {
                add("metrics" to JsonArray(metrics.map { obj(listOf("key" to JsonString(it.key), "value" to JsonString(it.value))) }))
            }
            if (participants.isNotEmpty()) add("participants" to JsonArray(participants.map { it.toJsonValue() }))
            if (events.isNotEmpty()) {
                add("events" to JsonArray(events.map { event -> event.toJsonValue("$id/${event.id}".takeIf { it in payloadIds }) }))
            }
            // The timing summary: each field when it is set, flat as the schema has it.
            accuracy?.let { add("accuracy" to JsonString(it.json)) }
            measuredRatio?.let { add("measuredRatio" to msNumber(it)) }
            pairedRatio?.let { add("pairedRatio" to msNumber(it)) }
            sources?.takeIf { it.isNotEmpty() }?.let { add("sources" to JsonArray(it.map(::JsonString))) }
            wallClockMs?.let { add("wallClockMs" to msNumber(it)) }
            clockOrdering?.let { add("clockOrdering" to JsonString(it.json)) }
            clockOrderedCount?.let { add("clockOrderedCount" to JsonNumber(it.toString())) }
            run {
                val summary = this@toJsonValue
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
                                    obj(
                                        buildList {
                                            it.from?.let { from -> add("from" to JsonString(from)) }
                                            it.to?.let { to -> add("to" to JsonString(to)) }
                                            add("accuracy" to JsonString(it.accuracy.json))
                                        },
                                    )
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
            stack?.takeIf { it.isNotEmpty() }?.let { add("stack" to JsonString(it)) }
        },
    )

private fun ReportOptionsJson.toJsonValue(): JsonValue =
    obj(
        listOf(
            "metricsEnabled" to JsonBool(metricsEnabled),
            "labelMaxChars" to JsonNumber(labelMaxChars.toString()),
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
            displayName?.takeIf { it.isNotEmpty() }?.let { add("displayName" to JsonString(it)) }
            color?.takeIf { it.isNotEmpty() }?.let { add("color" to JsonString(it)) }
            // The builder takes no empty key, as the schema has none.
            if (attributes.isNotEmpty()) add("attributes" to obj(attributes.map { (key, value) -> key to value.toJsonValue() }))
        },
    )

/**
 * The JSON for one event, as the schema's `DiagramEvent` describes it. [payloadId], on a message
 * in the diagram page's copy: the key of its payload, which loads on open (see [ReportJson.toJson]).
 */
internal fun EventJson.toJsonValue(payloadId: String? = null): JsonValue =
    when (this) {
        is MessageEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString("message"))
                    add("id" to JsonString(id))
                    from?.takeIf { it.isNotEmpty() }?.let { add("from" to JsonString(it)) }
                    to?.takeIf { it.isNotEmpty() }?.let { add("to" to JsonString(it)) }
                    add("label" to JsonString(label))
                    add("type" to JsonString(type))
                    color?.takeIf { it.isNotEmpty() }?.let { add("color" to JsonString(it)) }
                    durationMs?.let { add("durationMs" to msNumber(it)) }
                    data?.let { add("data" to it.toJsonValue()) }
                    // Page-only: the key into the payload sidecar. Not part of the format.
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
                    status?.takeIf { it.isNotEmpty() }?.let { add("status" to JsonString(it)) }
                    timing?.let { add("timing" to JsonString(it)) }
                    pairing?.let { add("pairing" to JsonString(it)) }
                    order?.let { add("order" to JsonString(it)) }
                    parentId?.let { add("parentId" to JsonString(it)) }
                    // The builder takes no empty key, as the schema has none.
                    if (attributes.isNotEmpty()) add("attributes" to obj(attributes.map { (key, value) -> key to value.toJsonValue() }))
                    origin?.let { add("origin" to JsonString(it)) }
                },
            )
        is NoteEventJson ->
            obj(
                buildList {
                    add("kind" to JsonString("note"))
                    add("id" to JsonString(id))
                    add("text" to JsonString(text))
                    over?.let { add("over" to JsonString(it)) }
                    add("placement" to JsonString(placement.json))
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
                    add("kind" to JsonString(kind.json))
                    add("id" to JsonString(id))
                    add("participantId" to JsonString(participantId))
                    color?.takeIf { it.isNotEmpty() }?.let { add("color" to JsonString(it)) }
                    startedAt?.let { add("startedAt" to JsonString(it)) }
                },
            )
    }

private fun obj(fields: List<Pair<String, JsonValue>>): JsonObject = JsonObject(fields)

/** An attribute's value: a String, Boolean, Long or Double, or a list of one of those, as [AttributeValueJson] allows. */
private fun AttributeValueJson.toJsonValue(): JsonValue = attributeJson(value)

private fun attributeJson(value: Any?): JsonValue =
    when (value) {
        is String -> JsonString(value)
        is Boolean -> JsonBool(value)
        is Long -> JsonNumber(value.toString())
        // Plain decimal, never an exponent: 1.0E10 would still be JSON, but not as written elsewhere.
        is Double -> JsonNumber(BigDecimal.valueOf(value).stripTrailingZeros().toPlainString())
        is List<*> -> JsonArray(value.map(::attributeJson))
        else -> JsonString(value.toString())
    }

/**
 * Report injected into the HTML shell. Method, path, and status stay on the message.
 * Any other payload field is removed from this copy and returned for the sidecar script.
 * [ReportJson.toJson] is unchanged so `report.json` still has the full capture.
 */
internal fun ReportJson.forShell(): ShellReport {
    val payloads = linkedMapOf<String, DataValueJson>()
    val light =
        toBuilder()
            .scenarios(
                scenarios.map { scenario ->
                    scenario
                        .toBuilder()
                        .events(
                            scenario.events.map { event ->
                                if (event !is MessageEventJson)
                                    event
                                else
                                    splitMessageForShell(scenario.id, event, payloads)
                            },
                        ).build()
                },
            ).build()
    return ShellReport(light, payloads)
}

internal data class ShellReport(
    val report: ReportJson,
    val payloads: Map<String, DataValueJson>,
) {
    /** The page copy's JSON, with `payloadId` on each message whose payload is in [payloads]. */
    fun toJson(): String = report.toJson(payloads.keys)
}

private fun splitMessageForShell(
    scenarioId: String,
    event: MessageEventJson,
    payloads: MutableMap<String, DataValueJson>,
): MessageEventJson {
    val data = event.data ?: return event
    val split = splitPayload(data)
    if (!split.defer) return event
    val id = "$scenarioId/${event.id}"
    payloads[id] = data
    return event
        .toBuilder()
        .data(split.summary)
        .build()
}

private data class PayloadSplit(val summary: DataValueJson?, val defer: Boolean)

private fun splitPayload(data: DataValueJson): PayloadSplit {
    if (data !is DataValueJson.ObjectValue) return PayloadSplit(summary = null, defer = true)
    val summary = linkedMapOf<String, DataValueJson>()
    var defer = false
    for ((name, value) in data.fields) {
        if (isSummaryField(name, value))
            summary[name] = value
        else
            defer = true
    }
    if (!defer) return PayloadSplit(summary = null, defer = false)
    return PayloadSplit(summary = summary.takeIf { it.isNotEmpty() }?.let(DataValueJson::ofObject), defer = true)
}

private fun isSummaryField(name: String, value: DataValueJson): Boolean =
    when (name) {
        "method", "path" -> value is DataValueJson.StringValue && value.value.isNotEmpty()
        "status" -> (value is DataValueJson.StringValue && value.value.isNotEmpty()) || value is DataValueJson.NumberValue
        else -> false
    }

/**
 * One entry per deferred payload, each as its compact JSON text: the shell parses a payload only
 * when it is opened or searched, not every body when the script loads (#63). The outer map is not
 * subject to the payload item limit.
 */
internal fun shellPayloadScript(payloads: Map<String, DataValueJson>): String =
    "window.__LSD_PAYLOAD_TEXT__=${JsonObject(payloads.map { (id, data) -> id to JsonString(data.toJsonValue().renderCompact()) }).render()};\n"
