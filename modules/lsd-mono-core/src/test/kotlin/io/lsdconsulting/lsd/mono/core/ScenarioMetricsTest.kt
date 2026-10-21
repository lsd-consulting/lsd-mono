package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.domain.formatMs
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.isErrorStatus
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import io.lsdconsulting.lsd.mono.report.model.testing.ReportCorpus
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant
import kotlin.io.path.readText

/**
 * Scenario metrics: message count and captured duration. `lsd.mono.metrics.enabled` defaults on
 * and empties them when false. There are no ranked duration insights: the Timing view shows slow calls.
 */
@LsdTestConfig(deterministicIds = true)
class ScenarioMetricsTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `a call with its own duration and a timed reply counts once`() {
        val lsd = LsdContext()
        lsd.message("A", "B", "call", timing = Timing.tookMs(100.0))
        lsd.response("B", "A", "reply", timing = Timing.tookMs(80.0))
        lsd.message("A", "C", "event", type = io.lsdconsulting.lsd.mono.core.domain.MessageType.ASYNCHRONOUS, timing = Timing.tookMs(5.0))
        lsd.completeScenario("once", "ok", Status.SUCCESS)
        lsd.completeReport("Once")
        val json = tempDir.resolve(ReportFileNames.stem("Once") + "-report.json").readText()
        assertTrue(json.contains("\"value\": \"105 ms\""), json)
    }

    @Test
    fun `interaction statuses drive the error count`() {
        val lsd = LsdContext()
        lsd.accept(Interaction(InteractionKind.REQUEST, "api", "pay", "POST /pay", interactionId = "c1"))
        lsd.accept(Interaction(InteractionKind.RESPONSE, "pay", "api", "503", status = "503", replyTo = "c1"))
        lsd.accept(Interaction(InteractionKind.REQUEST, "api", "pay", "POST /pay", interactionId = "c2"))
        lsd.accept(Interaction(InteractionKind.RESPONSE, "pay", "api", "201", status = "201 Created", replyTo = "c2"))
        lsd.accept(Interaction(InteractionKind.CONSUME, "kafka", "mail", "receipt", status = "FAILED"))
        lsd.completeScenario("errors", status = Status.SUCCESS)
        lsd.message("A", "B", "untagged")
        lsd.completeScenario("none", status = Status.SUCCESS)
        lsd.completeReport("Errors")
        val json = tempDir.resolve(ReportFileNames.stem("Errors") + "-report.json").readText()
        assertTrue(Regex("\"Errors\",\\s*\"value\": \"2\"").containsMatchIn(json), json)
        assertEquals(1, Regex("\"key\": \"Errors\"").findAll(json).count(), "no statuses, no Errors metric")
        assertTrue(json.contains("\"status\": \"503\""), json)
    }

    @Test
    fun `an error status is a 4xx or 5xx code, or an error word with no code`() {
        // Shared with the report UI's status.test.ts, in the shared test reports.
        val vectors = ReportCorpus.read("vectors/status-vectors.json")

        fun list(key: String) =
            Regex(""""$key":\s*\[(.*?)]""", RegexOption.DOT_MATCHES_ALL)
                .find(vectors)!!
                .groupValues[1]
                .let { Regex(""""((?:[^"\\]|\\.)*)"""").findAll(it).map { m -> m.groupValues[1] }.toList() }
        val errors = list("error")
        val fine = list("notError")
        assertTrue(errors.size > 5 && fine.size > 5, vectors)
        errors.forEach { assertTrue(isErrorStatus(it), it) }
        fine.forEach { assertFalse(isErrorStatus(it), it) }
    }

    @Test
    fun `enabled report json has the message count, captured duration and options, and no insights`() {
        System.setProperty(LsdProperties.LABEL_MAX_WIDTH, "12")
        val lsd = LsdContext()
        val longLabel = "abcdefghijklmnopqrstuvwxyz"
        lsd.message("A", "B", "parent", timing = Timing.tookMs(100.0))
        lsd.message("B", "C", longLabel, timing = Timing.tookMs(80.0))
        lsd.response("C", "B", "ok")
        lsd.response("B", "A", "done")
        lsd.completeScenario("timed", "ok", Status.SUCCESS)
        lsd.completeReport("Metrics")

        val json = tempDir.resolve(ReportFileNames.stem("Metrics") + "-report.json").readText()
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
        System.setProperty(LsdProperties.METRICS_ENABLED, "false")
        val lsd = LsdContext()
        lsd.message("A", "B", "ping", timing = Timing.tookMs(40.0))
        lsd.completeScenario("quiet", "", Status.SUCCESS)
        lsd.completeReport("No metrics")

        val json = tempDir.resolve(ReportFileNames.stem("No metrics") + "-report.json").readText()
        assertTrue(json.contains("\"metricsEnabled\": false"))
        assertTrue(json.contains("\"metrics\": []"))
        assertFalse(json.contains("\"insights\""))
        assertFalse(json.contains("\"key\": \"Messages\""))
        assertFalse(json.contains("\"key\": \"Captured duration\""))
        assertFalse(json.contains("Bottleneck"))
        assertFalse(json.contains("Slowest"))
        assertTrue(json.contains("\"label\": \"ping\""))
    }

    private fun capturedDuration(name: String, capture: (LsdContext) -> Unit): String? {
        val lsd = LsdContext()
        capture(lsd)
        lsd.completeScenario(name, "", Status.SUCCESS)
        lsd.completeReport(name)
        val json = tempDir.resolve(ReportFileNames.stem(name) + "-report.json").readText()
        return Regex(""""key": "Captured duration",\s*"value": "([^"]+)"""").find(json)?.groupValues?.get(1)
    }

    @Test
    fun `an explicit measured duration wins over the time the reply really took`() {
        val total =
            capturedDuration("explicit") { lsd ->
                val call = lsd.call("A", "B", "slow")
                Thread.sleep(25)
                call.reply("ok", timing = Timing.tookMs(17.625))
            }
        assertEquals("17.625 ms", total)
    }

    @Test
    fun `call and reply timestamps give the duration when nothing was measured`() {
        val t0 = Instant.parse("2026-10-14T09:00:00Z")
        val total =
            capturedDuration("derived") { lsd ->
                val call = lsd.call("A", "B", "get", timing = Timing.at(t0))
                Thread.sleep(5)
                call.reply("ok", timing = Timing.at(t0.plusMillis(250)))
            }
        assertEquals("250 ms", total)
    }

    @Test
    fun `fractional and whole durations add up, and the same capture gives the same total every run`() {
        val capture = { lsd: LsdContext ->
            lsd.capture {
                "A" calls "B" label "one" took 12.5
                "B" calls "C" label "two" took 3L
            }
            val call = lsd.call("A", "C", "three", timing = Timing.at(Instant.EPOCH))
            call.reply("done", timing = Timing.tookMs(0.25))
        }
        assertEquals("15.75 ms", capturedDuration("sum-1", capture))
        assertEquals("15.75 ms", capturedDuration("sum-2", capture))
    }

    @Test
    fun `durations print whole or to three places`() {
        assertEquals("42", formatMs(42.0))
        assertEquals("17.625", formatMs(17.625))
        assertEquals("0.333", formatMs(1.0 / 3))
        assertEquals("2", formatMs(1.9999999))
        assertEquals("100", formatMs(100.0))
        assertEquals("0.001", formatMs(0.0005))
    }
}
