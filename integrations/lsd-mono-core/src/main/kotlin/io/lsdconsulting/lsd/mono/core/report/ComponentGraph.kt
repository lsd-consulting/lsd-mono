package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.abbreviate
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.escapeHtml
import io.lsdconsulting.lsd.mono.core.json.JsonArray
import io.lsdconsulting.lsd.mono.core.json.JsonNumber
import io.lsdconsulting.lsd.mono.core.json.JsonObject
import io.lsdconsulting.lsd.mono.core.json.JsonString
import io.lsdconsulting.lsd.mono.core.json.JsonValue
import io.lsdconsulting.lsd.mono.core.json.render
import io.lsdconsulting.lsd.mono.core.model.ComponentEdgeJson
import io.lsdconsulting.lsd.mono.core.model.ComponentGraphJson
import io.lsdconsulting.lsd.mono.core.model.ComponentNodeJson
import io.lsdconsulting.lsd.mono.core.model.MessageEventJson
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioJson
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min

/**
 * Message types that become architecture edges.
 *
 * Matches legacy `ComponentDiagramGenerator`: SYNCHRONOUS, ASYNCHRONOUS,
 * BI_DIRECTIONAL, LOST. [MessageType.SYNCHRONOUS_RESPONSE] is a return arrow,
 * not a new dependency, so a response-only scenario has no edges.
 * [MessageType.SHORT_INBOUND] and [MessageType.SHORT_OUTBOUND] point at a
 * phantom diagram edge rather than a component, so they are excluded too.
 *
 * Duplicate messages with the same from→to collapse to one edge. [ComponentEdgeJson.count]
 * is how many included messages used that pair. [ComponentEdgeJson.types] is the
 * distinct included types in first-seen order. Nodes are only the participants
 * that appear on an included edge (display name and type when known).
 */
val COMPONENT_EDGE_TYPES: Set<MessageType> =
    setOf(
        MessageType.SYNCHRONOUS,
        MessageType.ASYNCHRONOUS,
        MessageType.BI_DIRECTIONAL,
        MessageType.LOST,
    )

private val COMPONENT_EDGE_TYPE_NAMES: Set<String> = COMPONENT_EDGE_TYPES.map { it.name }.toSet()

data class ScenarioComponentGraph(
    val title: String,
    val graph: ComponentGraphJson,
)

data class ComponentsDocument(
    val title: String,
    val combined: ComponentGraphJson,
    val scenarios: List<ScenarioComponentGraph>,
)

fun componentGraph(
    events: List<SequenceEvent>,
    participants: List<Participant> = emptyList(),
): ComponentGraphJson {
    val names = participants.associate { it.id to (it.name to it.type.name) }
    val messages =
        events.mapNotNull { event ->
            if (event !is Message || event.type !in COMPONENT_EDGE_TYPES) return@mapNotNull null
            if (event.from.isBlank() || event.to.isBlank()) return@mapNotNull null
            Triple(event.from, event.to, event.type.name)
        }
    return buildGraph(messages, names)
}

/** Same edge rule as [componentGraph], read back from a scenario's report JSON. */
fun componentGraph(scenario: ScenarioJson): ComponentGraphJson {
    val names = scenario.participants.associate { it.id to (it.name to it.type) }
    val messages =
        scenario.events.mapNotNull { event ->
            if (event !is MessageEventJson || event.type !in COMPONENT_EDGE_TYPE_NAMES) return@mapNotNull null
            if (event.from.isBlank() || event.to.isBlank()) return@mapNotNull null
            Triple(event.from, event.to, event.type)
        }
    return buildGraph(messages, names)
}

/** Union of every scenario graph. Counts sum; types stay in first-seen order. */
fun componentGraph(report: ReportJson): ComponentGraphJson =
    combineComponentGraphs(report.scenarios.map { componentGraph(it) })

fun combineComponentGraphs(graphs: List<ComponentGraphJson>): ComponentGraphJson {
    data class Acc(val types: LinkedHashSet<String>, var count: Int)

    val nodes = linkedMapOf<String, ComponentNodeJson>()
    val edges = linkedMapOf<Pair<String, String>, Acc>()
    for (graph in graphs) {
        for (node in graph.nodes) {
            nodes.putIfAbsent(node.id, node)
        }
        for (edge in graph.edges) {
            val acc = edges.getOrPut(edge.from to edge.to) { Acc(linkedSetOf(), 0) }
            edge.types.forEach { acc.types.add(it) }
            acc.count += edge.count
        }
    }
    return ComponentGraphJson(
        nodes = nodes.values.toList(),
        edges = edges.map { (key, acc) -> ComponentEdgeJson(key.first, key.second, acc.types.toList(), acc.count) },
    )
}

private fun buildGraph(
    messages: List<Triple<String, String, String>>,
    names: Map<String, Pair<String, String>>,
): ComponentGraphJson {
    data class Acc(val types: LinkedHashSet<String>, var count: Int)

    val edges = linkedMapOf<Pair<String, String>, Acc>()
    for ((from, to, type) in messages) {
        val acc = edges.getOrPut(from to to) { Acc(linkedSetOf(), 0) }
        acc.types.add(type)
        acc.count++
    }
    val nodeIds = linkedSetOf<String>()
    edges.keys.forEach { (from, to) ->
        nodeIds.add(from)
        nodeIds.add(to)
    }
    return ComponentGraphJson(
        nodes =
            nodeIds.map { id ->
                val (name, type) = names[id] ?: (id to "PARTICIPANT")
                ComponentNodeJson(id = id, name = name, type = type)
            },
        edges =
            edges.map { (key, acc) ->
                ComponentEdgeJson(from = key.first, to = key.second, types = acc.types.toList(), count = acc.count)
            },
    )
}

internal fun ComponentGraphJson.toJsonValue(): JsonValue =
    JsonObject(
        listOf(
            "nodes" to JsonArray(nodes.map { it.toJsonValue() }),
            "edges" to JsonArray(edges.map { it.toJsonValue() }),
        ),
    )

private fun ComponentNodeJson.toJsonValue(): JsonValue =
    JsonObject(
        listOf(
            "id" to JsonString(id),
            "name" to JsonString(name),
            "type" to JsonString(type),
        ),
    )

private fun ComponentEdgeJson.toJsonValue(): JsonValue =
    JsonObject(
        listOf(
            "from" to JsonString(from),
            "to" to JsonString(to),
            "types" to JsonArray(types.map { JsonString(it) }),
            "count" to JsonNumber(count.toString()),
        ),
    )

fun ComponentsDocument.toJson(): String =
    JsonObject(
        listOf(
            "title" to JsonString(title),
            "combined" to combined.toJsonValue(),
            "scenarios" to
                JsonArray(
                    scenarios.map { scenario ->
                        JsonObject(
                            listOf(
                                "title" to JsonString(scenario.title),
                                "graph" to scenario.graph.toJsonValue(),
                            ),
                        )
                    },
                ),
        ),
    ).render() + "\n"

/**
 * Minimal component diagram. Edge type is a text label (`sync`, `async`, `lost`, `bi`)
 * plus a marker shape. Stroke colour is the same for every edge.
 */
internal fun renderComponentSvg(graph: ComponentGraphJson, title: String): String {
    val label = "${title.escapeHtml()} component graph, ${graph.nodes.size} nodes, ${graph.edges.size} edges"
    if (graph.nodes.isEmpty()) {
        return """
            <svg xmlns="http://www.w3.org/2000/svg" width="520" height="72" role="img" aria-label="$label">
              <title>No component edges</title>
              <text x="16" y="40" class="empty">No component edges</text>
            </svg>
            """.trimIndent()
    }
    val positions = layout(graph)
    val width = positions.maxOf { it.value.x } + NODE_W + PAD
    val height = positions.maxOf { it.value.y } + NODE_H + PAD
    val edges =
        graph.edges.joinToString("\n") { edge ->
            edgeSvg(edge, positions, graph.edges)
        }
    val nodes =
        graph.nodes.joinToString("\n") { node ->
            val at = positions.getValue(node.id)
            val caption = node.name.abbreviate(18).escapeHtml()
            """
            <g class="node">
              <title>${node.name.escapeHtml()} (${node.type.escapeHtml()})</title>
              <rect x="${at.x}" y="${at.y}" width="$NODE_W" height="$NODE_H" rx="8" class="node-box"/>
              <text x="${at.x + NODE_W / 2}" y="${at.y + 22}" text-anchor="middle">${caption}</text>
              <text x="${at.x + NODE_W / 2}" y="${at.y + 40}" text-anchor="middle" class="node-type">${node.type.escapeHtml()}</text>
            </g>
            """.trimIndent()
        }
    return """
        <svg xmlns="http://www.w3.org/2000/svg" width="$width" height="$height" role="img" aria-label="$label">
          <title>${title.escapeHtml()}</title>
          <defs>
            <marker id="mk-sync" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="9" refY="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 Z" class="marker-fill"/>
            </marker>
            <marker id="mk-async" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="9" refY="5" orient="auto-start-reverse">
              <path d="M1 1 L9 5 L1 9 Z" class="marker-open"/>
            </marker>
            <marker id="mk-bi" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="9" refY="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 Z" class="marker-fill"/>
            </marker>
            <marker id="mk-lost" viewBox="0 0 12 12" markerWidth="10" markerHeight="10" refX="10" refY="6" orient="auto">
              <path d="M2 2 L10 10 M10 2 L2 10" class="marker-open"/>
            </marker>
            <marker id="mk-mixed" viewBox="0 0 10 10" markerWidth="8" markerHeight="8" refX="5" refY="5" orient="auto">
              <path d="M5 0 L10 5 L5 10 L0 5 Z" class="marker-open"/>
            </marker>
          </defs>
          $edges
          $nodes
        </svg>
        """.trimIndent()
}

fun renderComponentsHtml(document: ComponentsDocument): String {
    val sections =
        buildString {
            append(sectionHtml("Combined", document.combined))
            document.scenarios.forEach { append(sectionHtml(it.title, it.graph)) }
        }
    return """
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8"/>
          <meta name="viewport" content="width=device-width, initial-scale=1"/>
          <title>${document.title.escapeHtml()}</title>
          <style>
            :root { color-scheme: light dark; }
            body { font-family: system-ui, sans-serif; margin: 1.5rem; line-height: 1.45; color: #0f172a; }
            svg { color: #0f172a; max-width: 100%; height: auto; }
            .node-box { fill: #fff; stroke: currentColor; }
            text { fill: currentColor; font-size: 13px; font-family: system-ui, sans-serif; }
            .node-type, .edge-label { font-size: 11px; }
            .edge { fill: none; stroke: currentColor; stroke-width: 1.5; }
            .marker-fill { fill: currentColor; stroke: none; }
            .marker-open { fill: none; stroke: currentColor; stroke-width: 1.4; }
            .legend { font-size: .95rem; }
            @media (prefers-color-scheme: dark) {
              body, svg { color: #e2e8f0; }
              .node-box { fill: #0f172a; }
            }
          </style>
        </head>
        <body>
          <h1>${document.title.escapeHtml()}</h1>
          <p class="legend">Derived from captured messages (not PlantUML). Each edge is one
             from→to pair. The label names the type and the count:
             <strong>sync</strong> filled arrow,
             <strong>async</strong> open arrow,
             <strong>lost</strong> cross,
             <strong>bi</strong> arrow both ways.
             Mixed types use a diamond plus the type names. Colour is not the only cue.</p>
          <p>JSON: <a href="components.json">components.json</a></p>
          $sections
        </body>
        </html>
        """.trimIndent()
}

/** Visible, non-colour cue for an edge. Example: `sync, lost x3`. */
internal fun edgeCue(edge: ComponentEdgeJson): String {
    val names = edge.types.map { typeCue(it) }.ifEmpty { listOf("edge") }
    return names.joinToString(", ") + " x" + edge.count
}

internal fun typeCue(type: String): String =
    when (type) {
        "SYNCHRONOUS" -> "sync"
        "ASYNCHRONOUS" -> "async"
        "BI_DIRECTIONAL" -> "bi"
        "LOST" -> "lost"
        else -> type.lowercase()
    }

private fun sectionHtml(title: String, graph: ComponentGraphJson): String =
    """
    <section>
      <h2>${title.escapeHtml()}</h2>
      ${renderComponentSvg(graph, title)}
    </section>
    """.trimIndent()

private const val NODE_W = 160
private const val NODE_H = 52
private const val COLS = 4
private const val GAP_X = 96
private const val GAP_Y = 120
private const val PAD = 36

private data class At(val x: Int, val y: Int)

private fun layout(graph: ComponentGraphJson): Map<String, At> {
    val loop = graph.edges.any { it.from == it.to }
    val top = if (loop) PAD + 36 else PAD
    return graph.nodes.mapIndexed { index, node ->
        val col = index % COLS
        val row = index / COLS
        node.id to At(PAD + col * (NODE_W + GAP_X), top + row * (NODE_H + GAP_Y))
    }.toMap()
}

private fun edgeSvg(
    edge: ComponentEdgeJson,
    positions: Map<String, At>,
    all: List<ComponentEdgeJson>,
): String {
    val cue = edgeCue(edge)
    val from = positions[edge.from] ?: return ""
    val to = positions[edge.to] ?: return ""
    val marker = markerId(edge)
    val title = "${edge.from} to ${edge.to}: $cue"
    if (edge.from == edge.to) {
        val x = from.x
        val y = from.y
        val path = "M ${x + NODE_W - 18} $y C ${x + NODE_W + 40} ${y - 36}, ${x + 20} ${y - 36}, ${x + 20} $y"
        val labelX = x + NODE_W / 2
        val labelY = y - 28
        return """
            <g class="edge-group">
              <title>${title.escapeHtml()}</title>
              <path d="$path" class="edge" marker-end="url(#$marker)"/>
              <text x="$labelX" y="$labelY" text-anchor="middle" class="edge-label">${cue.escapeHtml()}</text>
            </g>
            """.trimIndent()
    }
    val reverse = all.any { it.from == edge.to && it.to == edge.from }
    val sign = if (!reverse) 0.0 else if (edge.from < edge.to) 12.0 else -12.0
    val x1 = from.x + NODE_W / 2.0
    val y1 = from.y + NODE_H / 2.0
    val x2 = to.x + NODE_W / 2.0
    val y2 = to.y + NODE_H / 2.0
    val start = border(x1, y1, x2, y2, sign)
    val end = border(x2, y2, x1, y1, sign)
    val midX = (start.first + end.first) / 2
    val midY = (start.second + end.second) / 2 - 8
    val startAttr = if (edge.types == listOf("BI_DIRECTIONAL")) """ marker-start="url(#mk-bi)"""" else ""
    return """
        <g class="edge-group">
          <title>${title.escapeHtml()}</title>
          <line x1="${fmt(start.first)}" y1="${fmt(start.second)}" x2="${fmt(end.first)}" y2="${fmt(end.second)}" class="edge"$startAttr marker-end="url(#$marker)"/>
          <text x="${fmt(midX)}" y="${fmt(midY)}" text-anchor="middle" class="edge-label">${cue.escapeHtml()}</text>
        </g>
        """.trimIndent()
}

private fun markerId(edge: ComponentEdgeJson): String =
    when (edge.types) {
        listOf("SYNCHRONOUS") -> "mk-sync"
        listOf("ASYNCHRONOUS") -> "mk-async"
        listOf("BI_DIRECTIONAL") -> "mk-bi"
        listOf("LOST") -> "mk-lost"
        else -> "mk-mixed"
    }

/** Point on the node border, shifted perpendicular by [shift] so opposing edges do not overlap. */
private fun border(cx: Double, cy: Double, tx: Double, ty: Double, shift: Double): Pair<Double, Double> {
    val dx = tx - cx
    val dy = ty - cy
    val len = hypot(dx, dy).takeIf { it > 0.0 } ?: 1.0
    val ox = -dy / len * shift
    val oy = dx / len * shift
    val sx = cx + ox
    val sy = cy + oy
    val ex = tx + ox
    val ey = ty + oy
    val vx = ex - sx
    val vy = ey - sy
    if (vx == 0.0 && vy == 0.0) return sx to sy
    val hw = NODE_W / 2.0
    val hh = NODE_H / 2.0
    val scaleX = if (vx == 0.0) Double.MAX_VALUE else hw / abs(vx)
    val scaleY = if (vy == 0.0) Double.MAX_VALUE else hh / abs(vy)
    val scale = min(scaleX, scaleY)
    return (sx + vx * scale) to (sy + vy * scale)
}

private fun fmt(n: Double): String = if (n % 1.0 == 0.0) n.toInt().toString() else "%.1f".format(n)
