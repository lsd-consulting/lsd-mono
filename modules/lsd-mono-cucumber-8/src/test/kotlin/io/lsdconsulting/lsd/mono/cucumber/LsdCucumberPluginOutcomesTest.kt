package io.lsdconsulting.lsd.mono.cucumber

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
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
@LsdTestConfig(deterministicIds = true)
class LsdCucumberPluginOutcomesTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun setUp() {
        LsdContext.instance.clear()
    }

    @AfterEach
    fun restore() {
        LsdContext.instance.clear()
    }

    private fun runOutcomes(): Map<String, String> {
        val summary = runFeatures("outcomes/outcomes.feature")
        assertEquals(7, summary.testsFoundCount.toInt())
        return scenariosByTitle(reportJson(tempDir, "outcomes"))
    }

    @Test
    fun `each Cucumber result becomes a scenario status`() {
        val statuses = runOutcomes().mapValues { (_, json) -> Regex(""""status": "(\w+)"""").find(json)!!.groupValues[1] }

        assertEquals(
            mapOf(
                "passes" to "success",
                "fails" to "error",
                "pending" to "warn",
                "undefined" to "warn",
                "skipped" to "warn",
                "ambiguous" to "warn",
                "hooked" to "success",
            ),
            statuses,
        )
    }

    @Test
    fun `a scenario that did not pass says why under its description`() {
        val errors = runOutcomes().mapValues { (_, json) -> errorOf(json) }

        assertEquals(null, errors["passes"])
        assertEquals(null, errors["hooked"])
        assertEquals("Failed", errors.getValue("fails")!!.first)
        assertTrue(errors.getValue("fails")!!.second.startsWith("card declined"))
        assertEquals("Pending" to "refunds come later\\nStep: When the refund is not written yet", errors["pending"])
        assertEquals("Skipped" to "payment provider offline\\nStep: When the payment provider is offline", errors["skipped"])
        val (ambiguous, ambiguity) = errors.getValue("ambiguous")!!
        assertEquals("Ambiguous step", ambiguous)
        assertTrue(ambiguity.contains("matches more than one step definition"), ambiguity)
        assertTrue(ambiguity.endsWith("\\nStep: When a coupon SAVE10 applies"), ambiguity)
    }

    @Test
    fun `an undefined step is named, with the step definition Cucumber suggests`() {
        val (headline, message) = errorOf(runOutcomes().getValue("undefined"))!!

        assertEquals("Undefined step", headline)
        assertTrue(message.startsWith("""When nobody wrote this step\n\nImplement it with:\nWhen(\"nobody wrote this step\""""), message)
    }

    @Test
    fun `only a failure keeps its stack trace`() {
        val scenarios = runOutcomes()

        assertTrue(scenarios.getValue("fails").contains(""""stack": "java.lang.IllegalStateException: card declined"""))
        listOf("pending", "undefined", "skipped", "ambiguous").forEach { title ->
            assertFalse(scenarios.getValue(title).contains(""""stack":"""), "$title has no stack")
        }
    }

    @Test
    fun `the description lists every step and marks the ones that did not pass`() {
        val scenarios = runOutcomes()

        assertTrue(
            scenarios.getValue("fails").contains(
                """"description": "Given the shop is open\nWhen the card is declined (failed)\nThen the basket is checked out (skipped)"""",
            ),
            scenarios.getValue("fails"),
        )
        assertTrue(
            scenarios.getValue("passes").contains(""""description": "Given the shop is open\nThen the basket is checked out""""),
            scenarios.getValue("passes"),
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

        assertEquals(
            listOf(
                "message audit opened",
                "section Given the shop is open",
                "message open basket",
                "section Then the basket is checked out",
                "message check out",
                "message audit closed",
            ),
            eventsOf(hooked),
        )
    }

    @Test
    fun `splitBySteps gives no section to a step skipped after a failure`() {
        System.setProperty(LsdProperties.CUCUMBER_SPLIT_BY_STEPS, "true")

        val scenarios = runOutcomes()

        assertEquals(
            listOf("section Given the shop is open", "message open basket", "section When the card is declined"),
            eventsOf(scenarios.getValue("fails")),
        )
        assertEquals(
            listOf("section Given the shop is open", "message open basket", "section When a coupon SAVE10 applies"),
            eventsOf(scenarios.getValue("ambiguous")),
        )
    }

    @Test
    fun `the end of the run writes the index with the feature's report`() {
        runOutcomes()

        val index = tempDir.resolve("index.html")
        assertTrue(index.exists())
        assertTrue(index.readText().contains("outcomes-"), "index links the outcomes report")
    }

    @Test
    fun `what the plugin writes follows the report schema`() {
        runOutcomes()

        assertTrue(ReportSchemas.assertOutputValid(tempDir) >= 4, "the report JSON, its page, its data script and the index")
    }

    /** The scenario's error as (headline, message), JSON escapes left in; null when it has none. */
    private fun errorOf(json: String): Pair<String, String>? =
        Regex(""""error": \{\s*"headline": "([^"]*)",\s*"message": "((?:[^"\\]|\\.)*)"""")
            .find(json)
            ?.let { it.groupValues[1] to it.groupValues[2] }

    /** The scenario's events in order: `section <title>` or `message <label>`. */
    private fun eventsOf(json: String): List<String> =
        Regex(""""kind": "(\w+)",\s*"id": "\d+",\s*(?:"title"|"from": "\w+",\s*"to": "\w+",\s*"label"): "([^"]+)"""")
            .findAll(json)
            .map { "${it.groupValues[1]} ${it.groupValues[2]}" }
            .toList()
}
