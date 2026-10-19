package io.lsdconsulting.lsd.mono.core.testing

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

    public operator fun get(key: String): Any? = obj[key]

    override fun toString(): String = json
}
