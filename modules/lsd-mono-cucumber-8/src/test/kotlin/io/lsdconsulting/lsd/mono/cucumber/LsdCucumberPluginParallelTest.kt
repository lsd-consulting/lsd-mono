package io.lsdconsulting.lsd.mono.cucumber

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.cucumber.fixture.ParallelSteps
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/**
 * Runs two features with Cucumber's parallel execution (four threads) and checks each
 * feature report holds only its own scenarios, each with only its own messages and
 * fact, and that outline rows keep their file order numbers (#24).
 */
@LsdTestConfig
class LsdCucumberPluginParallelTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun setUp() {
        System.setProperty("cucumber.publish.enabled", "false")
        LsdContext.instance.clear()
        ParallelSteps.maxInFlight.set(0)
    }

    @AfterEach
    fun clearContext() {
        LsdContext.instance.clear()
    }

    @Test
    fun `parallel scenarios and features each get only their own events`() {
        val summary =
            runFeatures(
                "parallel/checkout.feature",
                "parallel/returns.feature",
                parameters =
                    mapOf(
                        "cucumber.execution.parallel.enabled" to "true",
                        "cucumber.execution.parallel.config.strategy" to "fixed",
                        "cucumber.execution.parallel.config.fixed.parallelism" to "4",
                        "cucumber.execution.parallel.config.fixed.max-pool-size" to "4",
                    ),
            )

        assertEquals(0, summary.testsFailedCount.toInt(), summary.failures.joinToString { it.exception.stackTraceToString() })
        assertEquals(12, summary.testsSucceededCount.toInt())
        assertTrue(ParallelSteps.maxInFlight.get() > 1, "scenarios did not overlap, so this run proves nothing")

        listOf("checkout" to "c", "returns" to "r").forEach { (feature, p) ->
            val json = reportJson(tempDir, feature)
            val scenarios = scenariosByTitle(json)
            val titles = Regex(""""title": "([a-z][0-9]|[a-z] outline #[0-9])"""").findAll(json).map { it.groupValues[1] }.toList()
            assertEquals(
                listOf("${p}1", "${p}2", "${p}3", "$p outline #1", "$p outline #2", "$p outline #3").sorted(),
                titles.sorted(),
                "$feature report holds exactly its own scenarios",
            )
            val expectations = listOf("${p}1", "${p}2", "${p}3").associateWith { it } +
                (1..3).associate { n -> "$p outline #$n" to "${p}o$n" }
            expectations.forEach { (title, tag) ->
                val slice = scenarios[title] ?: error("missing scenario '$title'")
                val owners = Regex(""""label": "([a-z]+\d)-\d+"""").findAll(slice).map { it.groupValues[1] }.toList()
                assertEquals(30, owners.size, "$title should have 30 messages")
                assertEquals(setOf(tag), owners.toSet(), "$title has another scenario's messages")
                val facts = Regex(""""key": "scenario",\s*"value": "([a-z]+\d)"""").findAll(slice).map { it.groupValues[1] }.toList()
                assertEquals(listOf(tag), facts, "$title facts")
            }
        }
    }
}
