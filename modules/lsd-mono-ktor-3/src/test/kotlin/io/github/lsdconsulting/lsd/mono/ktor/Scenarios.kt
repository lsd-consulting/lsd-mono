package io.github.lsdconsulting.lsd.mono.ktor

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject

/** Starting a scenario, and reading back what it drew. */
internal object Scenarios {
    val lsd: LsdContext get() = LsdContext.instance

    fun start(
        key: String = "ktor-test",
        bind: Boolean = true,
    ): LsdScenario = lsd.beginScenario(reportKey = key, key = key, bindCurrentThread = bind)

    fun report(
        scenario: LsdScenario,
        key: String = "ktor-test",
    ): ScenarioJson {
        scenario.complete(key)
        return ReportJson.read(lsd.completeReport(key, key).reportJson).scenario(key)
    }

    /** The name of the participant with [id] (a message's `from` or `to`). */
    fun ScenarioJson.nameOf(id: Any?): String? = participant(id.toString()).string("name")

    /** A message as `from -> to`, by participant name. */
    fun ScenarioJson.arrow(message: JsonObject): String = "${nameOf(message["from"])} -> ${nameOf(message["to"])}"

    /** A message's body as drawn: the `body` beside its headers, else the data itself. */
    fun JsonObject.body(): Any? = (get("data") as? JsonObject)?.let { if (it.containsKey("body")) it["body"] else it } ?: get("data")
}
