package io.lsdconsulting.lsd.mono.cucumber

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.cucumber.fixture.ParallelSteps
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.platform.engine.discovery.DiscoverySelectors.selectClasspathResource
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder
import org.junit.platform.launcher.core.LauncherFactory
import org.junit.platform.launcher.listeners.SummaryGeneratingListener
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * Runs two features with Cucumber's parallel execution (four threads) and checks each
 * feature report holds only its own scenarios, each with only its own messages and
 * fact, and that outline rows keep their file order numbers (#24).
 */
class LsdCucumberPluginParallelTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("cucumber.publish.enabled", "false")
        LsdContext.instance.clear()
        ParallelSteps.maxInFlight.set(0)
    }

    @AfterEach
    fun restoreOutputDir() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
        LsdContext.instance.clear()
    }

    @Test
    fun `parallel scenarios and features each get only their own events`() {
        val summary = SummaryGeneratingListener()
        val request =
            LauncherDiscoveryRequestBuilder
                .request()
                .selectors(
                    selectClasspathResource("io/lsdconsulting/lsd/mono/cucumber/fixture/parallel/checkout.feature"),
                    selectClasspathResource("io/lsdconsulting/lsd/mono/cucumber/fixture/parallel/returns.feature"),
                ).configurationParameter("cucumber.glue", "io.lsdconsulting.lsd.mono.cucumber.fixture")
                .configurationParameter("cucumber.plugin", "io.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin")
                .configurationParameter("cucumber.publish.enabled", "false")
                .configurationParameter("cucumber.execution.parallel.enabled", "true")
                .configurationParameter("cucumber.execution.parallel.config.strategy", "fixed")
                .configurationParameter("cucumber.execution.parallel.config.fixed.parallelism", "4")
                .configurationParameter("cucumber.execution.parallel.config.fixed.max-pool-size", "4")
                .build()
        LauncherFactory.create().execute(request, summary)

        assertEquals(0, summary.summary.testsFailedCount.toInt(), summary.summary.failures.joinToString { it.exception.stackTraceToString() })
        assertEquals(12, summary.summary.testsSucceededCount.toInt())
        assertTrue(ParallelSteps.maxInFlight.get() > 1, "scenarios did not overlap, so this run proves nothing")

        listOf("checkout" to "c", "returns" to "r").forEach { (feature, p) ->
            val json = reportJson(feature)
            val titles = Regex(""""title": "([a-z][0-9]|[a-z] outline #[0-9])"""").findAll(json).map { it.groupValues[1] }.toList()
            assertEquals(
                listOf("${p}1", "${p}2", "${p}3", "$p outline #1", "$p outline #2", "$p outline #3").sorted(),
                titles.sorted(),
                "$feature report holds exactly its own scenarios",
            )
            val expectations = listOf("${p}1", "${p}2", "${p}3").associateWith { it } +
                (1..3).associate { n -> "$p outline #$n" to "${p}o$n" }
            expectations.forEach { (title, tag) ->
                val slice = scenarioSlice(json, title)
                val owners = Regex(""""label": "([a-z]+\d)-\d+"""").findAll(slice).map { it.groupValues[1] }.toList()
                assertEquals(30, owners.size, "$title should have 30 messages")
                assertEquals(setOf(tag), owners.toSet(), "$title has another scenario's messages")
                val facts = Regex(""""key": "scenario",\s*"value": "([a-z]+\d)"""").findAll(slice).map { it.groupValues[1] }.toList()
                assertEquals(listOf(tag), facts, "$title facts")
            }
        }
    }

    private fun reportJson(feature: String): String {
        val files = tempDir.listDirectoryEntries("$feature*-report.json")
        assertEquals(1, files.size, "expected one report for $feature in ${tempDir.listDirectoryEntries().map { it.name }}")
        return files.single().readText()
    }

    private fun scenarioSlice(json: String, title: String): String {
        val key = """"title": "$title""""
        val start = json.indexOf(key)
        assertTrue(start >= 0, "missing scenario '$title'")
        val next = json.indexOf("\"title\": \"", start + key.length)
        return if (next < 0) json.substring(start) else json.substring(start, next)
    }
}
