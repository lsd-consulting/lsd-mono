package io.lsdconsulting.lsd.mono.cucumber

import io.lsdconsulting.lsd.mono.core.LsdContext
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.platform.engine.discovery.DiscoverySelectors.selectClasspathResource
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder
import org.junit.platform.launcher.core.LauncherFactory
import org.junit.platform.launcher.listeners.SummaryGeneratingListener
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * Runs a feature through Cucumber 8 with [LsdCucumberPlugin] and checks the
 * written report JSON. The step captures the message. The plugin supplies the
 * scenario title, the step description, and the success status.
 */
class LsdCucumberPluginTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
        System.setProperty("cucumber.publish.enabled", "false")
        LsdContext.instance.clear()
    }

    @AfterEach
    fun restoreOutputDir() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
        System.clearProperty("lsd.mono.ids.deterministic")
        LsdContext.instance.clear()
    }

    @Test
    fun `scenario captured through the plugin lands in ReportJson`() {
        val summary = SummaryGeneratingListener()
        val request = LauncherDiscoveryRequestBuilder.request()
            .selectors(selectClasspathResource("io/lsdconsulting/lsd/mono/cucumber/fixture/place_order.feature"))
            .configurationParameter("cucumber.glue", "io.lsdconsulting.lsd.mono.cucumber.fixture")
            .configurationParameter("cucumber.plugin", "io.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin")
            .configurationParameter("cucumber.publish.enabled", "false")
            .build()
        LauncherFactory.create().execute(request, summary)

        assertEquals(0, summary.summary.testsFailedCount.toInt(), summary.summary.failures.toString())
        assertTrue(summary.summary.testsSucceededCount >= 1)

        val json = tempDir.resolve("place_order-report.json").readText()
        assertTrue(json.contains(""""title": "places an order""""), json)
        assertTrue(json.contains("When the customer places an order for socks"), json)
        assertTrue(json.contains(""""label": "POST /orders""""), json)
        assertTrue(json.contains(""""status": "success""""), json)
        assertFalse(json.contains("PlantUML"), json)
    }
}
