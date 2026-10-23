package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/**
 * Sections replace PlantUML newpage. They stay in one event stream and must not
 * drop activate/deactivate events on either side of the boundary.
 */
@LsdTestConfig(deterministicIds = true)
class SectionCaptureTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `two sections keep activations on both sides of the boundary`() {
        val lsd = LsdContext()
        lsd.addParticipants(
            PARTICIPANT.called("Api", id = "api"),
            PARTICIPANT.called("Db"),
        )
        lsd.activate("api")
        lsd.capture { "api" calls "Db" label "read" }
        lsd.section("Phase 2")
        lsd.capture { section("Phase 3") }
        lsd.response("Db", "api", "rows")
        lsd.deactivate("api")
        lsd.completeScenario("phased call", "activations survive sections", Status.SUCCESS)
        lsd.completeReport("Sections")

        val scenario = ReportJson.single(tempDir, ReportFileNames.stem("Sections") + "-report.json").scenario("phased call")
        val kinds = scenario.events.map { it["kind"] }
        assertEquals(
            listOf("activate", "message", "section", "section", "message", "deactivate"),
            kinds,
        )
        // In stream order: the activate before the first section, the deactivate after the last.
        assertEquals(listOf("Phase 2", "Phase 3"), scenario.eventsOf("section").map { it["title"] })
        assertEquals(listOf("api", "api"), scenario.events.filter { it["kind"] in setOf("activate", "deactivate") }.map { it["participantId"] })
    }
}
