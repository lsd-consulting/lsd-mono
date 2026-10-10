package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.lifeline
import io.lsdconsulting.lsd.mono.core.capture.messages
import io.lsdconsulting.lsd.mono.core.capture.section
import io.lsdconsulting.lsd.mono.core.capture.withLabel
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * Sections replace PlantUML newpage. They stay in one event stream and must not
 * drop activate/deactivate events on either side of the boundary.
 */
class SectionCaptureTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun deterministicOutput() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
    }

    @Test
    fun `two sections keep activations on both sides of the boundary`() {
        val lsd = LsdContext()
        lsd.addParticipants(
            PARTICIPANT.called("Api", id = "api"),
            PARTICIPANT.called("Db"),
        )
        lsd.capture(LifelineAction.ACTIVATE lifeline "api")
        lsd.capture("api" messages "Db" withLabel "read")
        lsd.section("Phase 2")
        lsd.capture(section("Phase 3"))
        lsd.response("Db", "api", "rows")
        lsd.deactivate("api")
        lsd.completeScenario("phased call", "activations survive sections", Status.SUCCESS)
        lsd.completeReport("Sections")

        val json = tempDir.resolve(ReportWriter.reportFileStem("Sections") + "-report.json").readText()
        val kinds = Regex(""""kind": "([^"]+)"""").findAll(json).map { it.groupValues[1] }.toList()
        assertEquals(
            listOf("activate", "message", "section", "section", "message", "deactivate"),
            kinds,
        )
        assertTrue(json.contains(""""title": "Phase 2""""))
        assertTrue(json.contains(""""title": "Phase 3""""))

        val activateAt = json.indexOf(""""kind": "activate"""")
        val phase2 = json.indexOf(""""title": "Phase 2"""")
        val phase3 = json.indexOf(""""title": "Phase 3"""")
        val deactivateAt = json.indexOf(""""kind": "deactivate"""")
        assertTrue(activateAt in 0 until phase2, "activate must precede the first section")
        assertTrue(phase2 < phase3)
        assertTrue(deactivateAt > phase3, "deactivate must follow the last section")
        assertEquals(2, Regex(""""participantId": "api"""").findAll(json).count())
    }
}
