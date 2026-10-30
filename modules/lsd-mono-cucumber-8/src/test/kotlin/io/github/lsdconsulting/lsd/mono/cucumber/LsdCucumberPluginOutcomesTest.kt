package io.github.lsdconsulting.lsd.mono.cucumber

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
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

    /** The report's scenarios by title, parsed (#109). */
    private fun runOutcomes(): Map<String, ScenarioJson> {
        val summary = runFeatures("outcomes/outcomes.feature")
        assertEquals(7, summary.testsFoundCount.toInt())
        val scenarios = ReportJson.single(tempDir, "outcomes-*-report.json").scenarios
        check(scenarios.map { it.title }.toSet().size == scenarios.size) { "duplicate titles: ${scenarios.map { it.title }}" }
        return scenarios.associateBy { it.title }
    }

    @Test
    fun `each Cucumber result becomes a scenario status`() {
        val statuses = runOutcomes().mapValues { (_, scenario) -> scenario.status }

        assertEquals(
            mapOf(
                "passes" to "success",
                "fails" to "error",
                "pending" to "warn",
                "undefined" to "warn",
                "skipped" to "skipped",
                "ambiguous" to "warn",
                "hooked" to "success",
            ),
            statuses,
        )
    }

    @Test
    fun `a scenario that did not pass says why under its description`() {
        val errors = runOutcomes().mapValues { (_, scenario) -> errorOf(scenario) }

        assertEquals(null, errors["passes"])
        assertEquals(null, errors["hooked"])
        assertEquals("Failed", errors.getValue("fails")!!.first)
        assertTrue(errors.getValue("fails")!!.second.startsWith("card declined"))
        assertEquals("Pending" to "refunds come later\nStep: When the refund is not written yet", errors["pending"])
        assertEquals("Skipped" to "payment provider offline\nStep: When the payment provider is offline", errors["skipped"])
        val (ambiguous, ambiguity) = errors.getValue("ambiguous")!!
        assertEquals("Ambiguous step", ambiguous)
        assertTrue(ambiguity.contains("matches more than one step definition"), ambiguity)
        assertTrue(ambiguity.endsWith("\nStep: When a coupon SAVE10 applies"), ambiguity)
    }

    @Test
    fun `an undefined step is named, with the step definition Cucumber suggests`() {
        val (headline, message) = errorOf(runOutcomes().getValue("undefined"))!!

        assertEquals("Undefined step", headline)
        assertTrue(message.startsWith("When nobody wrote this step\n\nImplement it with:\nWhen(\"nobody wrote this step\""), message)
    }

    @Test
    fun `only a failure keeps its stack trace`() {
        val scenarios = runOutcomes()

        val failed = scenarios.getValue("fails").error!!
        assertTrue(failed.string("stack")!!.startsWith("java.lang.IllegalStateException: card declined"), failed.toString())
        listOf("pending", "undefined", "skipped", "ambiguous").forEach { title ->
            val error = scenarios.getValue(title).error
            assertNotNull(error, "$title has an error")
            assertFalse("stack" in error!!, "$title has no stack: $error")
        }
    }

    @Test
    fun `the description lists every step and marks the ones that did not pass`() {
        val scenarios = runOutcomes()

        assertEquals(
            "Given the shop is open\nWhen the card is declined (failed)\nThen the basket is checked out (skipped)",
            scenarios.getValue("fails").description,
        )
        assertEquals("Given the shop is open\nThen the basket is checked out", scenarios.getValue("passes").description)
    }

    @Test
    fun `hooks capture into their scenario but are not steps, and no sections without splitBySteps`() {
        val scenarios = runOutcomes()

        val hooked = scenarios.getValue("hooked")
        assertEquals(listOf("audit opened", "open basket", "check out", "audit closed"), hooked.labels)
        assertEquals("Given the shop is open\nThen the basket is checked out", hooked.description)
        scenarios.forEach { (title, scenario) -> assertEquals(emptyList<Any?>(), scenario.eventsOf("section"), "$title has a section") }
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

    /** The scenario's error as (headline, message); null when it has none. */
    private fun errorOf(scenario: ScenarioJson): Pair<String, String>? =
        scenario.error?.let { (it.string("headline") ?: "") to (it.string("message") ?: "") }

    /** The scenario's sections and messages in order: `section <title>` or `message <label>`. */
    private fun eventsOf(scenario: ScenarioJson): List<String> =
        scenario.events.mapNotNull {
            when (it["kind"]) {
                "section" -> "section ${it["title"]}"
                "message" -> "message ${it["label"]}"
                else -> null
            }
        }
}
