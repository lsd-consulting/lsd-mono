package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Direct tests for [LsdProperties] and StringUtils (#25). lsd-mono-report-html's JsonTest tests its Json.kt. */
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
    }

    @Test
    fun abbreviate() {
        assertEquals("hello", "  hello  ".abbreviate(10))
        assertEquals("hel...", "hello world".abbreviate(6))
        assertEquals("he", "hello".abbreviate(2), "narrower than the ellipsis is a hard cut")
        assertEquals("", "hello".abbreviate(0))
        assertEquals("", "   ".abbreviate(5))
    }
}
