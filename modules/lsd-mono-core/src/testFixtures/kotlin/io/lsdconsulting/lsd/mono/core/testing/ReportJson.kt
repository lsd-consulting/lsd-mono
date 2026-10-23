package io.lsdconsulting.lsd.mono.core.testing

import io.lsdconsulting.lsd.mono.report.model.testing.Json
import io.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/** A written `*-report.json`, read with [Json], with its scenarios looked up by title (#74). */
public class ReportJson(
    /** The file's text. */
    public val text: String,
) {
    public val root: JsonObject = Json.parse(text) as JsonObject

    public val scenarios: List<ScenarioJson> = root.objects("scenarios").map(::ScenarioJson)

    public val titles: List<String> = scenarios.map { it.title }

    /** The report's `options` (metricsEnabled, labelMaxWidth, usagePing, source), empty when absent. */
    public val options: JsonObject get() = root.obj("options") ?: JsonObject(emptyMap(), "{}")

    /** The one scenario titled [title]; fails naming the titles there are when there is none, or more than one. */
    public fun scenario(title: String): ScenarioJson {
        val matches = scenarios.filter { it.title == title }
        check(matches.size == 1) { "expected one scenario titled '$title', found ${matches.size} in $titles" }
        return matches.single()
    }

    public companion object {
        public fun read(file: Path): ReportJson = ReportJson(file.readText())

        /** The one file in [dir] matching [glob] (such as `place_order-*-report.json`). */
        public fun single(
            dir: Path,
            glob: String,
        ): ReportJson {
            val files = dir.listDirectoryEntries(glob)
            check(files.size == 1) { "expected one $glob in $dir, found ${dir.listDirectoryEntries().map { it.name }}" }
            return read(files.single())
        }

        /** The report a `*-diagram.html` page carries (`window.__LSD_REPORT__`), parsed (#109). */
        public fun diagram(file: Path): ReportJson = ReportJson(embedded(file.readText(), "window.__LSD_REPORT__="))

        /**
         * The manifest the index page in [dir] carries (`window.__LSD_INDEX__`), parsed: its
         * `reports`, each with id, title, status, href, data and counts, and the run's options (#109).
         */
        public fun index(dir: Path): JsonObject =
            Json.parse(embedded(dir.resolve("index.html").readText(), "window.__LSD_INDEX__=")) as JsonObject

        /** The JSON a page assigns after [start], up to the end of its script. */
        private fun embedded(
            page: String,
            start: String,
        ): String {
            val from = page.indexOf(start).also { check(it >= 0) { "no $start in the page" } } + start.length
            val to = page.indexOf(";</script>", from).also { check(it >= 0) { "no end to $start" } }
            return page.substring(from, to)
        }
    }
}

/** One scenario of a [ReportJson]. */
public class ScenarioJson(
    public val obj: JsonObject,
) {
    /** This scenario's text as written, and only this scenario's. */
    public val json: String get() = obj.source

    public val title: String get() = obj.string("title") ?: error("a scenario without a title: $json")

    public val status: String? get() = obj.string("status")

    public val description: String? get() = obj.string("description")

    public val events: List<JsonObject> get() = obj.objects("events")

    /** The labels of the message events, in order. */
    public val labels: List<String> get() = events.filter { it["kind"] == "message" }.mapNotNull { it.string("label") }

    /** The facts, key to value, in order. */
    public val facts: List<Pair<String, String?>> get() = obj.objects("facts").map { (it.string("key") ?: "") to it.string("value") }

    public val error: JsonObject? get() = obj.obj("error")

    public val participants: List<JsonObject> get() = obj.objects("participants")

    /** The one participant with [id]; fails naming the ids there are. */
    public fun participant(id: String): JsonObject = one(participants, "participant with id '$id'", participants.map { it["id"] }) { it["id"] == id }

    /** The message events, in order. */
    public val messages: List<JsonObject> get() = events.filter { it["kind"] == "message" }

    /** The one message labelled [label]; fails naming the labels there are (#109). */
    public fun message(label: String): JsonObject = one(messages, "message labelled '$label'", labels) { it["label"] == label }

    /** The events of [kind] (activate, divider, note, section and so on), in order. */
    public fun eventsOf(kind: String): List<JsonObject> = events.filter { it["kind"] == kind }

    /** The metrics, key to value, in order. */
    public val metrics: List<Pair<String, String?>> get() = obj.objects("metrics").map { (it.string("key") ?: "") to it.string("value") }

    /** The value of the metric [key], or null when the scenario has no such metric. */
    public fun metric(key: String): String? = metrics.firstOrNull { it.first == key }?.second

    private fun one(
        from: List<JsonObject>,
        what: String,
        there: List<Any?>,
        match: (JsonObject) -> Boolean,
    ): JsonObject {
        val matches = from.filter(match)
        check(matches.size == 1) { "expected one $what in '$title', found ${matches.size} in $there" }
        return matches.single()
    }

    public operator fun get(key: String): Any? = obj[key]

    override fun toString(): String = json
}
