package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.json.anyToJson
import io.lsdconsulting.lsd.mono.core.json.jsonString
import io.lsdconsulting.lsd.mono.core.json.render
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Direct tests for Json.kt, [LsdProperties] and StringUtils (#25). */
class CoreHelpersTest {

    private val touched = listOf(
        LsdProperties.OUTPUT_DIR, "lsd.core.report.outputDir",
        LsdProperties.LABEL_MAX_WIDTH, "lsd.core.label.maxWidth",
        LsdProperties.METRICS_ENABLED, "lsd.core.metrics.enabled",
        LsdProperties.HIDE_STACKTRACE, "lsd.junit.hideStacktrace",
    )
    private val saved = touched.associateWith { System.getProperty(it) }

    @AfterEach
    fun restore() {
        saved.forEach { (key, value) -> if (value == null) System.clearProperty(key) else System.setProperty(key, value) }
    }

    @Test
    fun `jsonString escapes quotes, control characters and script-breaking markup`() {
        assertEquals(""""a\"b\\c"""", jsonString("a\"b\\c"))
        assertEquals(""""\n\r\t\u0001"""", jsonString("\n\r\t\u0001"))
        assertEquals(""""\u003c/script\u003e \u0026"""", jsonString("</script> &"))
        assertEquals(""""\u2028\u2029"""", jsonString("\u2028\u2029"))
        assertEquals("\"héllo ✓\"", jsonString("héllo ✓"))
    }

    @Test
    fun `anyToJson maps values and keeps non-finite numbers as strings`() {
        val json =
            anyToJson(
                mapOf(
                    "s" to "x", "i" to 1, "l" to 2L, "d" to 1.5, "nan" to Double.NaN,
                    "b" to true, "n" to null, "list" to listOf(1, "two"), "arr" to arrayOf(3), "other" to StringBuilder("sb"),
                ),
            ).render()
        listOf(
            """"s": "x"""", """"i": 1""", """"l": 2""", """"d": 1.5""", """"nan": "NaN"""",
            """"b": true""", """"n": null""", """"other": "sb"""",
        ).forEach { assertTrue(json.contains(it), "$it in $json") }
        assertTrue(Regex(""""list": \[\s*1,\s*"two"\s*]""").containsMatchIn(json), json)
        assertTrue(Regex(""""arr": \[\s*3\s*]""").containsMatchIn(json), json)
        assertEquals("{}", anyToJson(emptyMap<String, Any>()).render())
        assertEquals("[]", anyToJson(emptyList<Any>()).render())
    }

    @Test
    fun `properties prefer the mono key, then the legacy key, then the default`() {
        System.clearProperty(LsdProperties.OUTPUT_DIR)
        System.clearProperty("lsd.core.report.outputDir")
        assertEquals("build/reports/lsd", LsdProperties.outputDirectory())
        System.setProperty("lsd.core.report.outputDir", "legacy")
        assertEquals("legacy", LsdProperties.outputDirectory())
        System.setProperty(LsdProperties.OUTPUT_DIR, "mono")
        assertEquals("mono", LsdProperties.outputDirectory())

        System.clearProperty(LsdProperties.METRICS_ENABLED)
        System.clearProperty("lsd.core.metrics.enabled")
        assertTrue(LsdProperties.metricsEnabled())
        System.setProperty("lsd.core.metrics.enabled", "false")
        assertFalse(LsdProperties.metricsEnabled())

        System.setProperty(LsdProperties.HIDE_STACKTRACE, "true")
        assertTrue(LsdProperties.hideStacktrace())
        assertEquals("fallback", LsdProperties["lsd.mono.not.set", "fallback"])
    }

    @Test
    fun `label width falls back to 200 for missing, invalid or non-positive values`() {
        System.clearProperty(LsdProperties.LABEL_MAX_WIDTH)
        System.clearProperty("lsd.core.label.maxWidth")
        assertEquals(200, LsdProperties.labelMaxWidth())
        System.setProperty("lsd.core.label.maxWidth", "120")
        assertEquals(120, LsdProperties.labelMaxWidth())
        System.setProperty(LsdProperties.LABEL_MAX_WIDTH, "wide")
        assertEquals(200, LsdProperties.labelMaxWidth())
        System.setProperty(LsdProperties.LABEL_MAX_WIDTH, "0")
        assertEquals(200, LsdProperties.labelMaxWidth())
    }

    @Test
    fun `escapeHtml and abbreviate`() {
        assertEquals("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#x27;s&lt;/a&gt;", "<a href=\"x\">Tom & Jerry's</a>".escapeHtml())
        assertEquals("hello", "  hello  ".abbreviate(10))
        assertEquals("hel...", "hello world".abbreviate(6))
        assertEquals("he", "hello".abbreviate(2), "narrower than the ellipsis is a hard cut")
        assertEquals("", "hello".abbreviate(0))
        assertEquals("", "   ".abbreviate(5))
    }
}
