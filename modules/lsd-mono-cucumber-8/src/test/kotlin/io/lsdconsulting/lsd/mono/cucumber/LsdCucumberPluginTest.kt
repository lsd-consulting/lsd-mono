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

        val json = reportJson(tempDir, "place_order")
        assertTrue(json.contains(""""title": "places an order""""), json)
        assertTrue(json.contains("When the customer places an order for socks"), json)
        assertTrue(json.contains(""""label": "POST /orders""""), json)
        assertTrue(json.contains(""""status": "success""""), json)
        assertFalse(json.contains("PlantUML"), json)
        assertTrue(json.contains(""""source": "cucumber""""), "the usage ping counts the Cucumber plugin")
    }
}
