package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.Message
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant

@LsdTestConfig(deterministicIds = true)
class ActivateColourAndTimestampsTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `activate colour is optional in JSON and omitted when absent`() {
        val lsd = LsdContext()
        lsd.activate("api", colour = "#c026d3")
        lsd.activate("db")
        lsd.deactivate("api")
        lsd.completeScenario("coloured activation", status = Status.SUCCESS)
        lsd.completeReport("Activate colour")

        val scenario = ReportJson.single(tempDir, ReportFileNames.stem("Activate colour") + "-report.json").scenario("coloured activation")
        val activations = scenario.eventsOf("activate").associateBy { it["participantId"] }
        assertEquals(setOf("api", "db"), activations.keys)
        assertEquals("#c026d3", activations.getValue("api")["color"])
        assertFalse(activations.getValue("db").containsKey("color"), activations.getValue("db").toString())
        val deactivate = scenario.eventsOf("deactivate").single()
        assertEquals("api", deactivate["participantId"])
        assertFalse(deactivate.containsKey("color"), deactivate.toString())
    }

    @Test
    fun `out of order capture is sorted by startedAt before JSON`() {
        val lsd = LsdContext()
        lsd.capture(
            Message(
                id = "late",
                from = "A",
                to = "B",
                label = "late",
                startedAt = Instant.parse("2026-10-03T11:00:00Z"),
            ),
            Message(
                id = "early",
                from = "A",
                to = "B",
                label = "early",
                startedAt = Instant.parse("2026-10-03T09:00:00Z"),
            ),
            Message(id = "untimed", from = "A", to = "B", label = "untimed"),
            Message(
                id = "mid",
                from = "A",
                to = "B",
                label = "mid",
                startedAt = Instant.parse("2026-10-03T10:00:00Z"),
            ),
        )
        lsd.completeScenario("reordered", status = Status.SUCCESS)
        lsd.completeReport("Timestamps")

        val scenario = ReportJson.single(tempDir, ReportFileNames.stem("Timestamps") + "-report.json").scenario("reordered")
        // Timed events fill the timed slots in time order; the untimed one keeps its slot.
        assertEquals(listOf("early", "mid", "untimed", "late"), scenario.labels)
        assertTrue(scenario.messages.any { it["order"] == "clock" }, scenario.toString())
        assertEquals(
            mapOf("early" to "2026-10-03T09:00:00Z", "mid" to "2026-10-03T10:00:00Z", "untimed" to null, "late" to "2026-10-03T11:00:00Z"),
            scenario.messages.associate { it["label"] to it["startedAt"] },
        )
    }
}
