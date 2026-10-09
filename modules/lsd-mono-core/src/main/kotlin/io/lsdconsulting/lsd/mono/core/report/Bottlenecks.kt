package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.ReportOptions
import io.lsdconsulting.lsd.mono.core.abbreviate
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.model.InsightJson
import io.lsdconsulting.lsd.mono.core.model.MetricJson

/** How many duration insights to keep. Not a diagram split. */
const val MAX_INSIGHTS = 5

data class CapturedMetrics(
    val metrics: List<MetricJson>,
    val insights: List<InsightJson>,
)

/**
 * Message-count metrics plus duration insights.
 *
 * When at least one [MessageType.SYNCHRONOUS_RESPONSE] is present, insights are
 * bottleneck nodes: request/response pairs walked like the legacy call tree, ranked
 * by isolated duration (own duration minus nested children). Otherwise insights are
 * the slowest messages by `durationMs`. PlantUML generation timings are not included.
 *
 * Returns empty lists when [ReportOptions.metricsEnabled] is false.
 */
fun capturedMetrics(events: List<SequenceEvent>, options: ReportOptions): CapturedMetrics {
    if (!options.metricsEnabled) return CapturedMetrics(emptyList(), emptyList())
    val messages = events.filterIsInstance<Message>()
    val duration = messages.mapNotNull { it.durationMs }.sum()
    val insights = durationInsights(messages)
    val metrics =
        buildList {
            add(MetricJson("Messages", messages.size.toString()))
            if (duration > 0) add(MetricJson("Captured duration", "$duration ms"))
            insights.forEach { insight ->
                add(MetricJson(insight.metricKey(), insight.summary(options.labelMaxWidth)))
            }
        }
    return CapturedMetrics(metrics, insights)
}

internal fun durationInsights(messages: List<Message>, limit: Int = MAX_INSIGHTS): List<InsightJson> {
    if (messages.isEmpty() || limit <= 0) return emptyList()
    val paired = messages.any { it.type == MessageType.SYNCHRONOUS_RESPONSE }
    return if (paired) bottleneckInsights(messages, limit) else slowestInsights(messages, limit)
}

private fun slowestInsights(messages: List<Message>, limit: Int): List<InsightJson> =
    messages
        .withIndex()
        .filter { (it.value.durationMs ?: 0L) > 0L }
        .sortedWith(compareByDescending<IndexedValue<Message>> { it.value.durationMs ?: 0L }.thenBy { it.index })
        .take(limit)
        .mapIndexed { rank, indexed ->
            val message = indexed.value
            val ms = message.durationMs ?: 0L
            InsightJson(
                rank = rank + 1,
                kind = "slowest",
                participant = message.to.ifBlank { message.from },
                label = message.label,
                from = message.from,
                to = message.to,
                messageId = message.id,
                totalMs = ms,
                isolatedMs = ms,
            )
        }

private fun bottleneckInsights(messages: List<Message>, limit: Int): List<InsightJson> {
    val nodes = flatten(buildTree(messages)).filter { it.request != null && it.isolatedMs > 0L }
    return nodes
        .sortedWith(compareByDescending<CallNode> { it.isolatedMs }.thenBy { it.order })
        .take(limit)
        .mapIndexed { rank, node ->
            val request = node.request!!
            InsightJson(
                rank = rank + 1,
                kind = "bottleneck",
                participant = request.to.ifBlank { request.from },
                label = request.label,
                from = request.from,
                to = request.to,
                messageId = request.id,
                totalMs = node.totalMs,
                isolatedMs = node.isolatedMs,
            )
        }
}

/**
 * Direction-based call tree (legacy `createTree` idea, without HTML).
 * A message whose `to` is the current caller's id is that call's response.
 */
internal fun buildTree(messages: List<Message>): CallNode {
    val root = CallNode(order = -1)
    var seq = 0

    fun nextOrder(): Int = seq++
    messages.fold(root) { node, message ->
        val nodeName = node.name
        val parentName = node.parent?.name
        when {
            nodeName != null && message.to == nodeName -> {
                node.response = message
                node.parent ?: node
            }
            parentName != null && message.to == parentName -> {
                node.parent.response = message
                node.parent
            }
            nodeName != null && message.from == nodeName && node.parent != null -> {
                val child = CallNode(request = message, parent = node.parent, order = nextOrder())
                node.parent.children.add(child)
                node.parent
            }
            else -> {
                val child = CallNode(request = message, parent = node, order = nextOrder())
                node.children.add(child)
                child
            }
        }
    }
    return root
}

internal class CallNode(
    val request: Message? = null,
    var response: Message? = null,
    val parent: CallNode? = null,
    val children: MutableList<CallNode> = mutableListOf(),
    val order: Int = 0,
) {
    val name: String? get() = request?.from

    val totalMs: Long
        get() = (request?.durationMs ?: 0L) + (response?.durationMs ?: 0L)

    val childrenMs: Long
        get() = children.sumOf { it.totalMs }

    val isolatedMs: Long
        get() = totalMs - childrenMs
}

private fun flatten(node: CallNode): List<CallNode> = listOf(node) + node.children.flatMap { flatten(it) }

private fun InsightJson.metricKey(): String =
    if (kind == "bottleneck") "Bottleneck $rank" else "Slowest $rank"

private fun InsightJson.summary(labelMaxWidth: Int): String {
    val who = participant.ifBlank { from }
    val shown = label.abbreviate(labelMaxWidth)
    return if (kind == "bottleneck") {
        "$who rank $rank isolated $isolatedMs ms (total $totalMs ms) — $shown"
    } else {
        "$who rank $rank $totalMs ms — $shown"
    }
}
