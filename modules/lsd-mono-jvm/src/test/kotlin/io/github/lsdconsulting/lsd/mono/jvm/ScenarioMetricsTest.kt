package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.Status
import io.github.lsdconsulting.lsd.mono.jvm.domain.formatMs
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.report.isErrorStatus
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportCorpus
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant

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
        lsd.message("A", "C", "event", type = io.github.lsdconsulting.lsd.mono.jvm.domain.MessageType.ASYNCHRONOUS, timing = Timing.tookMs(5.0))
        lsd.completeScenario("once", "ok", Status.SUCCESS)
        lsd.completeReport("Once")
        assertEquals("105 ms", report("Once").scenario("once").metric("Captured duration"))
    }

    @Test
    fun `interaction statuses drive the error count`() {
        val lsd = LsdContext()
        lsd.accept(Interaction.builder(InteractionKind.REQUEST, "api", "pay", "POST /pay").interactionId("c1").build())
        lsd.accept(
            Interaction
                .builder(InteractionKind.RESPONSE, "pay", "api", "503")
                .status("503")
                .replyTo("c1")
                .build(),
        )
        lsd.accept(Interaction.builder(InteractionKind.REQUEST, "api", "pay", "POST /pay").interactionId("c2").build())
        lsd.accept(
            Interaction
                .builder(InteractionKind.RESPONSE, "pay", "api", "201")
                .status("201 Created")
                .replyTo("c2")
                .build(),
        )
        lsd.accept(Interaction.builder(InteractionKind.CONSUME, "kafka", "mail", "receipt").status("FAILED").build())
        lsd.completeScenario("errors", status = Status.SUCCESS)
        lsd.message("A", "B", "untagged")
        lsd.completeScenario("none", status = Status.SUCCESS)
        lsd.completeReport("Errors")
        val report = report("Errors")
        val errors = report.scenario("errors")
        assertEquals("2", errors.metric("Errors"))
        assertNull(report.scenario("none").metric("Errors"), "no statuses, no Errors metric")
        assertEquals("503", errors.message("503")["status"])
    }

    @Test
    fun `an error status is a 4xx or 5xx code, or an error word with no code`() {
        // Shared with the report UI's status.test.ts, in the shared test reports.
        val vectors = Json.parse(ReportCorpus.read("vectors/status-vectors.json")) as JsonObject

        @Suppress("UNCHECKED_CAST")
        fun list(key: String) = vectors[key] as List<String>
        val errors = list("error")
        val fine = list("notError")
        assertTrue(errors.size > 5 && fine.size > 5, vectors.source)
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

        val report = report("Metrics")
        assertEquals(true, report.options["metricsEnabled"])
        assertEquals(12.0, report.options["labelMaxWidth"])
        val scenario = report.scenario("timed")
        assertEquals(listOf("Messages", "Captured duration"), scenario.metrics.map { it.first })
        assertEquals("180 ms", scenario.metric("Captured duration"))
        assertTrue(longLabel in scenario.labels, "event labels stay full: ${scenario.labels}")
        // No ranked duration insights, anywhere (#109: absent keys, not missing text).
        assertFalse("insights" in report.root, report.root.keys.toString())
        assertTrue(report.scenarios.none { "insights" in it.obj }, "no scenario has insights")
    }

    @Test
    fun `disabled metrics omit the counts`() {
        System.setProperty(LsdProperties.METRICS_ENABLED, "false")
        val lsd = LsdContext()
        lsd.message("A", "B", "ping", timing = Timing.tookMs(40.0))
        lsd.completeScenario("quiet", "", Status.SUCCESS)
        lsd.completeReport("No metrics")

        val report = report("No metrics")
        assertEquals(false, report.options["metricsEnabled"])
        val scenario = report.scenario("quiet")
        // Present and empty, not missing: an absent list would pass a "no metrics" check vacuously.
        assertEquals(emptyList<Any?>(), scenario["metrics"])
        assertFalse("insights" in report.root)
        assertFalse("insights" in scenario.obj)
        assertEquals(listOf("ping"), scenario.labels)
    }

    private fun capturedDuration(name: String, capture: (LsdContext) -> Unit): String? {
        val lsd = LsdContext()
        capture(lsd)
        lsd.completeScenario(name, "", Status.SUCCESS)
        lsd.completeReport(name)
        return report(name).scenario(name).metric("Captured duration")
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

    /** The written report titled [title], parsed (#109). */
    private fun report(title: String): ReportJson = ReportJson.single(tempDir, ReportFileNames.stem(title) + "-report.json")
}
