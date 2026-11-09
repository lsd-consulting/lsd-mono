package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.concurrent.thread

/**
 * A report written while another thread is still analysing a completed scenario must include
 * that scenario once, not drop it into a gap between the running set and the stored list (#235).
 */
@LsdTestConfig(deterministicIds = true)
class CompleteReportRaceTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `a report written while a scenario is completing still includes that scenario`() {
        val lsd = LsdContext()
        val scenario = lsd.beginScenario(reportKey = "race", key = "order")
        repeat(8_000) { i -> scenario.message("A", "B", "m$i") }

        val completer =
            thread(name = "complete-scenario") {
                scenario.complete("Placed the order", "completed by the test")
            }
        while (lsd.findScenario("order") != null) {
            Thread.onSpinWait()
        }
        val first = ReportJson.read(lsd.completeReport("First report", "race").reportJson)
        completer.join()
        val second = ReportJson.read(lsd.completeReport("Second report", "race").reportJson)

        assertEquals(1, first.scenarios.size, first.text)
        val stored = first.scenarios.single()
        if (stored.status == "success") {
            assertEquals("Placed the order", stored.title, stored.json)
            assertEquals("completed by the test", stored.description, stored.json)
        } else {
            assertEquals("warn", stored.status, stored.json)
            assertEquals("order", stored.title, stored.json)
            assertEquals(LsdContext.NOT_COMPLETED_NOTE, stored.description, stored.json)
        }
        assertEquals(0, second.scenarios.size, second.text)
    }

    @Test
    fun `scenarios completed before the report is written stay one each`() {
        val lsd = LsdContext()
        val first = lsd.beginScenario(reportKey = "done", key = "first")
        first.message("A", "B", "one")
        first.complete("first")
        val second = lsd.beginScenario(reportKey = "done", key = "second")
        second.message("A", "B", "two")
        second.complete("second")

        val report = ReportJson.read(lsd.completeReport("Already done", "done").reportJson)
        assertEquals(listOf("first", "second"), report.titles)
        assertTrue("one" in report.scenario("first").labels)
        assertTrue("two" in report.scenario("second").labels)
    }
}
