package io.github.lsdconsulting.lsd.mono.jvm.live

import io.github.lsdconsulting.lsd.mono.jvm.domain.Scenario
import io.github.lsdconsulting.lsd.mono.jvm.report.ReportJsonMapper
import io.github.lsdconsulting.lsd.mono.report.html.ReportWriter

/**
 * The frames of the live capture protocol (v0, `modules/lsd-mono-studio/protocol`). A scenario's
 * participants, events, status and error come from the same mapping and the same JSON writer as
 * the written report, so a live report holds what the file holds.
 */
internal class LiveFrames(
    private val mapper: ReportJsonMapper,
) {
    /**
     * The hello: [title] is the report's, when the integration named it. The sender is the report's
     * `generator` (`lsd-mono-jvm` and its version), as the written report has it.
     */
    fun hello(title: String?): String {
        val report = reportMembers(title?.takeIf { it.isNotBlank() } ?: "-", emptyList())
        val titled = if (title.isNullOrBlank()) "" else ",\"title\":" + report.getValue("title")
        return "{\"type\":\"hello\",\"protocol\":\"$PROTOCOL\",\"version\":\"$VERSION\"$titled,\"sender\":${report.getValue("generator")}}"
    }

    /** scenario.start, one event frame per event, and scenario.end, for [scenario] under [scenarioId] (plain characters). */
    fun scenario(
        scenarioId: String,
        scenario: Scenario,
    ): List<String> {
        val json = LiveJson.members(LiveJson.items(reportMembers("live", listOf(scenario), scenarioId).getValue("scenarios")).single())
        val id = "\"scenarioId\":\"$scenarioId\""
        val participants = json["participants"]?.let { ",\"participants\":$it" }.orEmpty()
        val start = "{\"type\":\"scenario.start\",$id,\"title\":${json.getValue("title")}$participants}"
        val events = json["events"]?.let(LiveJson::items).orEmpty().map { "{\"type\":\"event\",$id,\"event\":$it}" }
        val error = json["error"]?.let { ",\"error\":$it" }.orEmpty()
        val end = "{\"type\":\"scenario.end\",$id,\"status\":${json.getValue("status")}$error}"
        return listOf(start) + events + end
    }

    private fun reportMembers(
        title: String,
        scenarios: List<Scenario>,
        scenarioId: String? = null,
    ): Map<String, String> {
        val report = mapper.toReportJson(title, scenarios, scenarioId = scenarioId?.let { id -> { id } })
        return LiveJson.members(LiveJson.compact(ReportWriter.toJson(report)))
    }

    companion object {
        const val PROTOCOL: String = "lsd-live"
        const val VERSION: String = "0.1.0"
        const val SENDER: String = "lsd-mono-jvm"
        const val DONE: String = "{\"type\":\"report.done\"}"
    }
}
