package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.lifeline
import io.lsdconsulting.lsd.mono.core.capture.withColour
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant
import kotlin.io.path.readText

class ActivateColourAndTimestampsTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun deterministicOutput() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
    }

    @Test
    fun `activate colour is optional in JSON and omitted when absent`() {
        val lsd = LsdContext()
        lsd.capture(LifelineAction.ACTIVATE lifeline "api" withColour "#c026d3")
        lsd.activate("db")
        lsd.deactivate("api")
        lsd.completeScenario("coloured activation", status = Status.SUCCESS)
        lsd.completeReport("Activate colour")

        val json = tempDir.resolve(ReportWriter.reportFileStem("Activate colour") + "-report.json").readText()
        assertTrue(json.contains("\"kind\": \"activate\""))
        assertTrue(json.contains("\"participantId\": \"api\""))
        assertTrue(json.contains("\"colour\": \"#c026d3\""))
        val plain = json.substringAfter("\"participantId\": \"db\"")
        assertFalse(plain.take(40).contains("\"colour\""), plain.take(80))
        val deactivate = json.substringAfter("\"kind\": \"deactivate\"")
        assertFalse(deactivate.take(80).contains("\"colour\""))
    }

    @Test
    fun `out of order capture is sorted by createdAt before JSON`() {
        val lsd = LsdContext()
        lsd.capture(
            Message(
                id = "late",
                from = "A",
                to = "B",
                label = "late",
                createdAt = Instant.parse("2026-10-03T11:00:00Z"),
            ),
            Message(
                id = "early",
                from = "A",
                to = "B",
                label = "early",
                createdAt = Instant.parse("2026-10-03T09:00:00Z"),
            ),
            Message(id = "untimed", from = "A", to = "B", label = "untimed"),
            Message(
                id = "mid",
                from = "A",
                to = "B",
                label = "mid",
                createdAt = Instant.parse("2026-10-03T10:00:00Z"),
            ),
        )
        lsd.completeScenario("reordered", status = Status.SUCCESS)
        lsd.completeReport("Timestamps")

        val json = tempDir.resolve(ReportWriter.reportFileStem("Timestamps") + "-report.json").readText()
        val early = json.indexOf("\"label\": \"early\"")
        val mid = json.indexOf("\"label\": \"mid\"")
        val late = json.indexOf("\"label\": \"late\"")
        val untimed = json.indexOf("\"label\": \"untimed\"")
        assertTrue(early in 0 until mid, json)
        assertTrue(mid < late)
        assertTrue(late < untimed)
        assertTrue(json.contains("\"createdAt\": \"2026-10-03T09:00:00Z\""))
        assertTrue(json.contains("\"createdAt\": \"2026-10-03T10:00:00Z\""))
        assertTrue(json.contains("\"createdAt\": \"2026-10-03T11:00:00Z\""))
    }
}
