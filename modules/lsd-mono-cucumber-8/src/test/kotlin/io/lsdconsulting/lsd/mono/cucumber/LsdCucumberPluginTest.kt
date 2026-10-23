package io.lsdconsulting.lsd.mono.cucumber

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * Runs a feature through Cucumber 8 with [LsdCucumberPlugin] and checks the
 * written report JSON. The step captures the message. The plugin supplies the
 * scenario title, the step description, and the success status.
 */
@LsdTestConfig(deterministicIds = true)
class LsdCucumberPluginTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun setUp() {
        System.setProperty("cucumber.publish.enabled", "false")
        LsdContext.instance.clear()
    }

    @AfterEach
    fun clearContext() {
        LsdContext.instance.clear()
    }

    @Test
    fun `scenario captured through the plugin lands in ReportJson`() {
        val summary = runFeatures("place_order.feature")

        assertEquals(0, summary.testsFailedCount.toInt(), summary.failures.toString())
        assertTrue(summary.testsSucceededCount >= 1)

        val report = reportJson(tempDir, "place_order")
        val json = report.text
        val scenario = report.scenario("places an order")
        assertTrue(json.contains("When the customer places an order for socks"), json)
        assertTrue("POST /orders" in scenario.labels, scenario.json)
        assertEquals("success", scenario.status, scenario.json)
        assertFalse(json.contains("PlantUML"), json)
        assertEquals("cucumber", report.options["source"], "the usage ping counts the Cucumber plugin")
    }

    @Test
    fun `the report is titled by the Feature name and its files keep the feature file's name`() {
        val summary = runFeatures("place_order.feature")
        assertEquals(0, summary.testsFailedCount.toInt(), summary.failures.toString())

        assertEquals("Place an order", reportJson(tempDir, "place_order").root.string("title"))
        val stem = tempDir
            .listDirectoryEntries("*-diagram.html")
            .single()
            .name
            .removeSuffix("-diagram.html")
        assertTrue(Regex("place_order-[0-9a-f]{8}").matches(stem), stem)
        val index = tempDir.resolve("index.html").readText()
        assertTrue(index.contains("$stem-diagram.html"), "the index links the unchanged file name")
        assertTrue(index.contains("Place an order"), "the index shows the Feature name")
    }

    @Test
    fun `a feature with a blank name keeps the file name as its title`() {
        val summary = runFeatures("untitled/untitled_order.feature")
        assertEquals(0, summary.testsFailedCount.toInt(), summary.failures.toString())

        assertEquals("untitled_order", reportJson(tempDir, "untitled_order").root.string("title"))
    }
}
