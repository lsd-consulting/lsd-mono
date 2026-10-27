package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Direct tests for [LsdProperties] (#25). lsd-mono-report-html's JsonTest tests its Json.kt. */
@LsdTestConfig
class CoreHelpersTest {
    @Test
    fun `properties prefer the key, then the default`() {
        System.clearProperty(LsdProperties.OUTPUT_DIR)
        assertEquals("build/reports/lsd", LsdProperties.outputDirectory())
        System.setProperty(LsdProperties.OUTPUT_DIR, "mono")
        assertEquals("mono", LsdProperties.outputDirectory())

        System.clearProperty(LsdProperties.METRICS_ENABLED)
        assertTrue(LsdProperties.metricsEnabled())
        System.setProperty(LsdProperties.METRICS_ENABLED, "false")
        assertFalse(LsdProperties.metricsEnabled())

        System.setProperty(LsdProperties.HIDE_STACKTRACE, "true")
        assertTrue(LsdProperties.hideStacktrace())
    }

    @Test
    fun `label width falls back to 200 for missing, invalid or non-positive values`() {
        System.clearProperty(LsdProperties.LABEL_MAX_WIDTH)
        assertEquals(200, LsdProperties.labelMaxWidth())
        System.setProperty(LsdProperties.LABEL_MAX_WIDTH, "120")
        assertEquals(120, LsdProperties.labelMaxWidth())
        System.setProperty(LsdProperties.LABEL_MAX_WIDTH, "wide")
        assertEquals(200, LsdProperties.labelMaxWidth())
        System.setProperty(LsdProperties.LABEL_MAX_WIDTH, "0")
        assertEquals(200, LsdProperties.labelMaxWidth())
        // One default everywhere: the property, the options and the JSON; the report UI checks it too (#111).
        assertEquals(ReportOptions.DEFAULT_LABEL_MAX_WIDTH, LsdProperties.labelMaxWidth())
        assertEquals(ReportOptions.DEFAULT_LABEL_MAX_WIDTH, ReportOptionsJson.builder().build().labelMaxWidth)
    }
}
