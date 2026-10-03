package io.lsdconsulting.lsd.mono.core.model

import io.lsdconsulting.lsd.mono.core.json.JsonArray
import io.lsdconsulting.lsd.mono.core.json.JsonBool
import io.lsdconsulting.lsd.mono.core.json.JsonNumber
import io.lsdconsulting.lsd.mono.core.json.JsonObject
import io.lsdconsulting.lsd.mono.core.json.JsonString
import io.lsdconsulting.lsd.mono.core.json.JsonValue
import io.lsdconsulting.lsd.mono.core.json.anyToJson
import io.lsdconsulting.lsd.mono.core.json.render
import io.lsdconsulting.lsd.mono.core.report.toJsonValue

/**
 * Report JSON aligned with report-next `src/types.ts` (`Report` / `Scenario` / `DiagramEvent`).
 */
data class ReportFile(
    val filename: String,
    val title: String,
    val status: String,
)

data class ReportOptionsJson(
    /** When false, scenario `metrics` and `insights` are empty. Default true. */
    val metricsEnabled: Boolean = true,
    /** Character width used to truncate labels in the shell and in metric summaries. */
    val labelMaxWidth: Int = 200,
)

data class ReportJson(
    val title: String,
    val generatedAt: String,
    val generator: String,
    /**
     * Worst scenario outcome: `error` > `warn` > `success`
     * (legacy ERROR > FAILURE > SUCCESS). `success` when there are no scenarios.
     */
    val status: String,
    val options: ReportOptionsJson = ReportOptionsJson(),
    val scenarios: List<ScenarioJson>,
)

data class ScenarioErrorJson(
    val headline: String,
    val message: String,
    val stack: String? = null,
)

data class ScenarioJson(
    val id: String,
    val title: String,
    val status: String,
    val description: String,
    val facts: List<FactJson>,
    val metrics: List<MetricJson> = emptyList(),
    /** Omitted from JSON when empty (metrics disabled, or no timed messages). */
    val insights: List<InsightJson> = emptyList(),
    val participants: List<ParticipantJson> = emptyList(),
    val events: List<EventJson> = emptyList(),
    /** Present for failed/aborted scenarios. Omitted from JSON when null. */
    val error: ScenarioErrorJson? = null,
    /**
     * Per-scenario component graph. Present only when `lsd.mono.components.enabled=true`.
     * Omitted from JSON when null (the default).
     */
    val components: ComponentGraphJson? = null,
)

data class FactJson(
    val key: String,
    val value: String,
)

data class MetricJson(
    val key: String,
    val value: String,
)

/**
 * One ranked duration insight. [kind] is `bottleneck` (paired call, isolated time)
 * or `slowest` (no response pairing). [rank] is 1-based and is the non-colour cue.
 */
data class InsightJson(
    val rank: Int,
    val kind: String,
    val participant: String,
    val label: String,
    val from: String,
    val to: String,
    val messageId: String,
    val totalMs: Long,
    val isolatedMs: Long,
)

/**
 * One component in the architecture graph. [id] matches message `from` / `to`
 * (participant id after capture). [type] is the participant type, not an edge colour.
 */
data class ComponentNodeJson(
    val id: String,
    val name: String,
    val type: String = "PARTICIPANT",
)

/**
 * One from→to dependency. [types] are included message types in first-seen order.
 * [count] is how many of those messages collapsed onto this edge.
 * The shell labels the type in text; colour is not the cue.
 */
data class ComponentEdgeJson(
    val from: String,
    val to: String,
    val types: List<String>,
    val count: Int,
)

data class ComponentGraphJson(
    val nodes: List<ComponentNodeJson> = emptyList(),
    val edges: List<ComponentEdgeJson> = emptyList(),
)

data class ParticipantJson(
    val id: String,
    val name: String,
    val type: String = "PARTICIPANT",
    val alias: String? = null,
    val colour: String? = null,
)

sealed class EventJson {
    internal abstract fun toJsonValue(): JsonValue
}

data class MessageEventJson(
    val id: String,
    val from: String,
    val to: String,
    val label: String,
    val type: String,
    val colour: String? = null,
    val durationMs: Long? = null,
    val data: Any? = null,
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
                if (durationMs != null) add("durationMs" to JsonNumber(durationMs.toString()))
                if (data != null) add("data" to anyToJson(data))
            },
        )
}

data class NoteEventJson(
    val id: String,
    val text: String,
    /** Anchor participant. Required for placement `over`; optional for left/right. */
    val over: String? = null,
    val placement: String = "over",
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("note"))
                add("id" to JsonString(id))
                add("text" to JsonString(text))
                if (over != null) add("over" to JsonString(over))
                add("placement" to JsonString(placement))
            },
        )
}

data class DelayEventJson(
    val id: String,
    val label: String? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("delay"))
                add("id" to JsonString(id))
                if (label != null) add("label" to JsonString(label))
            },
        )
}

data class SpacerEventJson(
    val id: String,
    val heightPx: Int? = null,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            buildList {
                add("kind" to JsonString("spacer"))
                add("id" to JsonString(id))
                if (heightPx != null) add("heightPx" to JsonNumber(heightPx.toString()))
            },
        )
}

data class DividerEventJson(
    val id: String,
    val label: String,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            listOf(
                "kind" to JsonString("divider"),
                "id" to JsonString(id),
                "label" to JsonString(label),
            ),
        )
}

data class SectionEventJson(
    val id: String,
    val title: String,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            listOf(
                "kind" to JsonString("section"),
                "id" to JsonString(id),
                "title" to JsonString(title),
            ),
        )
}

data class LifelineEventJson(
    val kind: String,
    val id: String,
    val participantId: String,
) : EventJson() {
    internal override fun toJsonValue(): JsonValue =
        obj(
            listOf(
                "kind" to JsonString(kind),
                "id" to JsonString(id),
                "participantId" to JsonString(participantId),
            ),
        )
}

fun ReportJson.toJson(): String =
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
            if (insights.isNotEmpty()) add("insights" to JsonArray(insights.map { it.toJsonValue() }))
            add("participants" to JsonArray(participants.map { it.toJsonValue() }))
            add("events" to JsonArray(events.map { it.toJsonValue() }))
            if (components != null) add("components" to components.toJsonValue())
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

private fun InsightJson.toJsonValue(): JsonValue =
    obj(
        listOf(
            "rank" to JsonNumber(rank.toString()),
            "kind" to JsonString(kind),
            "participant" to JsonString(participant),
            "label" to JsonString(label),
            "from" to JsonString(from),
            "to" to JsonString(to),
            "messageId" to JsonString(messageId),
            "totalMs" to JsonNumber(totalMs.toString()),
            "isolatedMs" to JsonNumber(isolatedMs.toString()),
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
