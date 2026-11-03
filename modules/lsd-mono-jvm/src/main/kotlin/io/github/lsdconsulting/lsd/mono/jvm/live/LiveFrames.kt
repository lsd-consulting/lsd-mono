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
    ): List<String> = parts(scenarioId, scenario).let { listOf(it.start) + it.events.map(LiveEvent::frame) + it.end }

    /** [scenario]'s frames under [scenarioId], with what a stream sending it a piece at a time needs to know. */
    fun parts(
        scenarioId: String,
        scenario: Scenario,
    ): LiveScenario {
        val json = LiveJson.members(LiveJson.items(reportMembers("live", listOf(scenario), scenarioId).getValue("scenarios")).single())
        val id = "\"scenarioId\":\"$scenarioId\""
        val listed = json["participants"]?.let { ",\"participants\":$it" }.orEmpty()
        val start = "{\"type\":\"scenario.start\",$id,\"title\":${json.getValue("title")}$listed}"
        val events =
            json["events"]?.let(LiveJson::items).orEmpty().map { event ->
                val members = LiveJson.members(event)
                LiveEvent(
                    id = members["id"].orEmpty(),
                    call = members["type"] == "\"synchronous\"",
                    replyTo = members["replyTo"],
                    frame = "{\"type\":\"event\",$id,\"event\":$event}",
                )
            }
        val error = json["error"]?.let { ",\"error\":$it" }.orEmpty()
        val end = "{\"type\":\"scenario.end\",$id,\"status\":${json.getValue("status")}$error}"
        return LiveScenario(json.getValue("title"), start, events, end)
    }

    /** A sender error about [scenarioId]'s scenario, shown on it in LSD Studio. */
    fun error(
        scenarioId: String,
        message: String,
    ): String = "{\"type\":\"error\",\"scenarioId\":\"$scenarioId\",\"message\":${quoted(message)}}"

    /** scenario.end for a scenario its test discarded, which the report file leaves out. */
    fun discarded(scenarioId: String): String =
        "{\"type\":\"scenario.end\",\"scenarioId\":\"$scenarioId\",\"status\":\"skipped\"," +
            "\"error\":{\"headline\":\"Discarded\",\"message\":${quoted(DISCARDED)}}}"

    private fun quoted(text: String): String = reportMembers(text, emptyList()).getValue("title")

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
        const val DISCARDED: String = "Its test discarded it (a retried test runs again), so the report file leaves it out."
        const val DIFFERS: String =
            "This scenario changed as it completed (its events were ordered or paired again, or its title changed), " +
                "so the live view differs from the report file. The report file is right."
    }
}

/** A scenario's frames, and its title as JSON, for sending a piece at a time. */
internal class LiveScenario(
    val title: String,
    val start: String,
    val events: List<LiveEvent>,
    val end: String,
)

/**
 * One event frame: its event's [id] (JSON), whether it is a [call] (a synchronous request),
 * and the call a reply answers ([replyTo], JSON).
 */
internal class LiveEvent(
    val id: String,
    val call: Boolean,
    val replyTo: String?,
    val frame: String,
)
