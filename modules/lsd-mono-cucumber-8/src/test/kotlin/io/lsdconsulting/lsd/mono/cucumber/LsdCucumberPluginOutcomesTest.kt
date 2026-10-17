package io.lsdconsulting.lsd.mono.cucumber

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readText

/**
 * Runs outcomes.feature, one scenario per Cucumber result plus one with hooks, and checks what
 * the plugin writes for each: status, error, description, sections, and the index.
 */
class LsdCucumberPluginOutcomesTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
        LsdContext.instance.clear()
    }

    @AfterEach
    fun restore() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
        System.clearProperty("lsd.mono.ids.deterministic")
        System.clearProperty(LsdProperties.CUCUMBER_SPLIT_BY_STEPS)
        LsdContext.instance.clear()
    }

    private fun runOutcomes(): Map<String, String> {
        val summary = runFeatures("outcomes/outcomes.feature")
        // fails and undefined fail the JUnit test, skipped aborts it, pending fails it too.
        assertEquals(6, summary.testsFoundCount.toInt())
        return scenariosByTitle(reportJson(tempDir, "outcomes"))
    }

    @Test
    fun `each Cucumber result becomes a scenario status, with the error only for a failure`() {
        val scenarios = runOutcomes()

        val statuses = scenarios.mapValues { (_, json) -> Regex(""""status": "(\w+)"""").find(json)!!.groupValues[1] }
        assertEquals(
            mapOf(
                "passes" to "success",
                "fails" to "error",
                "pending" to "warn",
                "undefined" to "warn",
                "skipped" to "warn",
                "hooked" to "success",
            ),
            statuses,
        )
        val fails = scenarios.getValue("fails")
        assertTrue(fails.contains(""""headline": "Failed""""), fails)
        assertTrue(fails.contains(""""message": "card declined""""), fails)
        scenarios.filterKeys { it != "fails" }.forEach { (title, json) ->
            assertFalse(json.contains(""""error":"""), "$title has no error")
        }
    }

    @Test
    fun `the description lists every step, including the ones a failure skipped`() {
        val fails = runOutcomes().getValue("fails")

        assertTrue(
            fails.contains(""""description": "Given the shop is open\nWhen the card is declined\nThen the basket is checked out""""),
            fails,
        )
    }

    @Test
    fun `hooks capture into their scenario but are not steps, and no sections without splitBySteps`() {
        val scenarios = runOutcomes()

        val hooked = scenarios.getValue("hooked")
        assertEquals(
            listOf("audit opened", "open basket", "check out", "audit closed"),
            Regex(""""label": "([^"]+)"""").findAll(hooked).map { it.groupValues[1] }.toList(),
        )
        assertTrue(hooked.contains(""""description": "Given the shop is open\nThen the basket is checked out""""), hooked)
        scenarios.forEach { (title, json) -> assertFalse(json.contains(""""kind": "section""""), "$title has a section") }
    }

    @Test
    fun `splitBySteps starts a section at each step and none at a hook`() {
        System.setProperty(LsdProperties.CUCUMBER_SPLIT_BY_STEPS, "true")

        val hooked = runOutcomes().getValue("hooked")

        val events = Regex(""""kind": "(\w+)",\s*"id": "\d+",\s*(?:"title"|"from": "\w+",\s*"to": "\w+",\s*"label"): "([^"]+)"""")
            .findAll(hooked)
            .map { "${it.groupValues[1]} ${it.groupValues[2]}" }
            .toList()
        assertEquals(
            listOf(
                "message audit opened",
                "section Given the shop is open",
                "message open basket",
                "section Then the basket is checked out",
                "message check out",
                "message audit closed",
            ),
            events,
        )
    }

    @Test
    fun `the end of the run writes the index with the feature's report`() {
        runOutcomes()

        val index = tempDir.resolve("index.html")
        assertTrue(index.exists())
        assertTrue(index.readText().contains("outcomes-"), "index links the outcomes report")
    }
}
