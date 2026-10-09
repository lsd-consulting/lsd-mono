package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.report.durationInsights
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * Duration insights: paired calls rank by isolated time; unpaired messages rank by
 * duration. `lsd.mono.metrics.enabled` defaults on and empties metrics when false.
 */
class BottleneckInsightsTest {

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
    fun `paired calls rank by isolated duration not total`() {
        val messages =
            listOf(
                msg("m1", "a", "b", "parent", MessageType.SYNCHRONOUS, 100),
                msg("m2", "b", "c", "child", MessageType.SYNCHRONOUS, 80),
                msg("m3", "c", "b", "ok", MessageType.SYNCHRONOUS_RESPONSE, 0),
                msg("m4", "b", "a", "done", MessageType.SYNCHRONOUS_RESPONSE, 0),
            )
        val insights = durationInsights(messages)
        assertEquals(listOf("bottleneck", "bottleneck"), insights.map { it.kind })
        assertEquals(listOf(1, 2), insights.map { it.rank })
        assertEquals("c", insights[0].participant)
        assertEquals(80, insights[0].isolatedMs)
        assertEquals("m2", insights[0].messageId)
        assertEquals("b", insights[1].participant)
        assertEquals(20, insights[1].isolatedMs)
        assertEquals(100, insights[1].totalMs)
    }

    @Test
    fun `without a response the slowest messages are ranked by duration`() {
        val messages =
            listOf(
                msg("s1", "a", "b", "five", MessageType.ASYNCHRONOUS, 5),
                msg("s2", "a", "b", "fifty", MessageType.SYNCHRONOUS, 50),
                msg("s3", "a", "b", "ten", MessageType.SYNCHRONOUS, 10),
                msg("s4", "a", "b", "none", MessageType.SYNCHRONOUS, null),
            ) + (1..4).map { n -> msg("x$n", "a", "b", "extra$n", MessageType.SYNCHRONOUS, 1L) }
        val insights = durationInsights(messages)
        assertEquals(5, insights.size)
        assertTrue(insights.all { it.kind == "slowest" })
        assertEquals(listOf(50L, 10L, 5L, 1L, 1L), insights.map { it.totalMs })
        assertEquals("fifty", insights[0].label)
        assertEquals(1, insights[0].rank)
    }

    @Test
    fun `enabled report json includes bottleneck keys and options`() {
        System.setProperty("lsd.mono.label.maxWidth", "12")
        val lsd = LsdContext()
        val longLabel = "abcdefghijklmnopqrstuvwxyz"
        lsd.message("A", "B", "parent", MessageType.SYNCHRONOUS, durationMs = 100)
        lsd.message("B", "C", longLabel, MessageType.SYNCHRONOUS, durationMs = 80)
        lsd.response("C", "B", "ok")
        lsd.response("B", "A", "done")
        lsd.completeScenario("timed", "ok", Status.SUCCESS)
        lsd.completeReport("Insights")

        val json = tempDir.resolve(ReportWriter.reportFileStem("Insights") + "-report.json").readText()
        assertTrue(json.contains("\"metricsEnabled\": true"))
        assertTrue(json.contains("\"labelMaxWidth\": 12"))
        assertTrue(json.contains("\"key\": \"Messages\""))
        assertTrue(json.contains("\"key\": \"Captured duration\""))
        assertTrue(json.contains("\"key\": \"Bottleneck 1\""))
        assertTrue(json.contains("\"key\": \"Bottleneck 2\""))
        assertTrue(json.contains("rank 1 isolated 80 ms"))
        assertTrue(json.contains("abcdefghi..."))
        assertTrue(json.contains("\"label\": \"$longLabel\""), "event and insight labels stay full")
        assertTrue(json.contains("\"kind\": \"bottleneck\""))
        assertTrue(json.contains("\"rank\": 1"))
        val first = json.indexOf("\"isolatedMs\": 80")
        val second = json.indexOf("\"isolatedMs\": 20")
        assertTrue(first in 0 until second, "faster isolated child should rank first")
        assertFalse(json.contains("Time to generate"))
    }

    @Test
    fun `disabled metrics omit counts and insights`() {
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

    private fun msg(
        id: String,
        from: String,
        to: String,
        label: String,
        type: MessageType,
        durationMs: Long?,
    ) = Message(id = id, from = from, to = to, label = label, type = type, durationMs = durationMs)
}
