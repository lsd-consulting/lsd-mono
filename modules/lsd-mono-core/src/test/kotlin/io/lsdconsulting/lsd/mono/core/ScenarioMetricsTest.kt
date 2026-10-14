package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * Scenario metrics: message count and captured duration. `lsd.mono.metrics.enabled` defaults on
 * and empties them when false. There are no ranked duration insights: the Timing view shows slow calls.
 */
class ScenarioMetricsTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun deterministicOutput() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
    }

    @AfterEach
    fun clearGates() {
        listOf(
            "lsd.mono.metrics.enabled",
            "lsd.core.metrics.enabled",
            "lsd.mono.label.maxWidth",
            "lsd.core.label.maxWidth",
            "lsd.mono.report.outputDir",
            "lsd.mono.ids.deterministic",
        ).forEach { System.clearProperty(it) }
    }

    @Test
    fun `enabled report json has the message count, captured duration and options, and no insights`() {
        System.setProperty("lsd.mono.label.maxWidth", "12")
        val lsd = LsdContext()
        val longLabel = "abcdefghijklmnopqrstuvwxyz"
        lsd.message("A", "B", "parent", durationMs = 100)
        lsd.message("B", "C", longLabel, durationMs = 80)
        lsd.response("C", "B", "ok")
        lsd.response("B", "A", "done")
        lsd.completeScenario("timed", "ok", Status.SUCCESS)
        lsd.completeReport("Metrics")

        val json = tempDir.resolve(ReportWriter.reportFileStem("Metrics") + "-report.json").readText()
        assertTrue(json.contains("\"metricsEnabled\": true"))
        assertTrue(json.contains("\"labelMaxWidth\": 12"))
        assertTrue(json.contains("\"key\": \"Messages\""))
        assertTrue(json.contains("\"key\": \"Captured duration\""))
        assertTrue(json.contains("\"value\": \"180 ms\""))
        assertTrue(json.contains("\"label\": \"$longLabel\""), "event labels stay full")
        assertFalse(json.contains("\"insights\""))
        assertFalse(json.contains("Bottleneck"))
        assertFalse(json.contains("Time to generate"))
    }

    @Test
    fun `disabled metrics omit the counts`() {
        System.setProperty("lsd.mono.metrics.enabled", "false")
        val lsd = LsdContext()
        lsd.message("A", "B", "ping", durationMs = 40)
        lsd.completeScenario("quiet", "", Status.SUCCESS)
        lsd.completeReport("No metrics")

        val json = tempDir.resolve(ReportWriter.reportFileStem("No metrics") + "-report.json").readText()
        assertTrue(json.contains("\"metricsEnabled\": false"))
        assertTrue(json.contains("\"metrics\": []"))
        assertFalse(json.contains("\"insights\""))
        assertFalse(json.contains("\"key\": \"Messages\""))
        assertFalse(json.contains("\"key\": \"Captured duration\""))
        assertFalse(json.contains("Bottleneck"))
        assertFalse(json.contains("Slowest"))
        assertTrue(json.contains("\"label\": \"ping\""))
    }
}
