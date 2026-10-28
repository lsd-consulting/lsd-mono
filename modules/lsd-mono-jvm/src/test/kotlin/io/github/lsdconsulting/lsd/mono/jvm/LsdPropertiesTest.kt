package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioError
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdKey
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Path
import kotlin.io.path.readLines

/** The [LsdKey] table: keys, defaults, and the README table that documents it. */
@LsdTestConfig
class LsdPropertiesTest {
    @Test
    fun `every key prefers its set value, then its default`() {
        LsdKey.entries.forEach { key ->
            System.clearProperty(key.key)
            assertEquals(key.default, key.value(), key.key)
            System.setProperty(key.key, "mono")
            assertEquals("mono", key.value(), key.key)
        }
    }

    @Test
    fun `lsd-core's names for the keys are not read`() {
        val lsdCoreNames =
            mapOf(
                LsdKey.OUTPUT_DIR to "lsd.core.report.outputDir",
                LsdKey.DETERMINISTIC_IDS to "lsd.core.ids.deterministic",
                LsdKey.HIDE_STACKTRACE to "lsd.junit.hideStacktrace",
                LsdKey.METRICS_ENABLED to "lsd.core.metrics.enabled",
                LsdKey.LABEL_MAX_WIDTH to "lsd.core.label.maxWidth",
            )
        lsdCoreNames.forEach { (key, name) ->
            System.clearProperty(key.key)
            System.setProperty(name, "7")
            try {
                assertEquals(key.default, key.value(), name)
            } finally {
                System.clearProperty(name)
            }
        }
    }

    @Test
    fun `the API reference lists every key with its default`() {
        val rows =
            Path
                .of("../../docs/jvm-api.md")
                .readLines()
                .filter { it.startsWith("| `lsd.mono.") }
                .map { line -> line.split('|').map { it.trim().removeSurrounding("`") } }
                .filter { it.size == 5 }
                .map { it[1] to it[2].takeUnless { cell -> cell == "unset" } }
        assertEquals(LsdKey.entries.map { it.key to it.default }, rows)
    }

    @Test
    fun `the integration reader follows its key`() {
        System.clearProperty(LsdProperties.CUCUMBER_SPLIT_BY_STEPS)
        @OptIn(InternalLsdApi::class)
        assertFalse(LsdProperties.cucumberSplitBySteps())
        System.setProperty(LsdProperties.CUCUMBER_SPLIT_BY_STEPS, "true")
        @OptIn(InternalLsdApi::class)
        assertTrue(LsdProperties.cucumberSplitBySteps())
    }

    @Test
    fun `payload limits fall back to their defaults for invalid values`() {
        System.setProperty(LsdProperties.PAYLOAD_MAX_DEPTH, " 7 ")
        System.setProperty(LsdProperties.PAYLOAD_MAX_ITEMS, "-1")
        System.setProperty(LsdProperties.PAYLOAD_MAX_TOTAL_SIZE, "lots")
        System.clearProperty(LsdProperties.PAYLOAD_MAX_STRING_LENGTH)
        val limits = io.github.lsdconsulting.lsd.mono.jvm.PayloadConverters.Limits
            .fromProperties()
        assertEquals(7, limits.maxDepth)
        assertEquals(1000, limits.maxItems)
        assertEquals(1_000_000, limits.maxTotalSize)
        assertEquals(100_000, limits.maxStringLength)
    }

    @Test
    fun `a scenario error carries the cause's message and stack unless stack traces are hidden`() {
        System.clearProperty(LsdProperties.HIDE_STACKTRACE)
        val cause = IllegalStateException("boom")
        val shown = ScenarioError.of("Failed", cause)
        assertEquals("Failed", shown.headline)
        assertEquals("boom", shown.message)
        assertEquals(cause.stackTraceToString(), shown.stack)

        System.setProperty(LsdProperties.HIDE_STACKTRACE, "true")
        assertEquals(ScenarioError("Failed", "boom", ScenarioError.HIDDEN_STACK), ScenarioError.of("Failed", cause))

        System.clearProperty(LsdProperties.HIDE_STACKTRACE)
        assertEquals(ScenarioError("Test aborted", "", ScenarioError.HIDDEN_STACK), ScenarioError.of("Test aborted", null))
    }

    @Test
    fun `generatedAt is read only when it is an ISO-8601 instant`() {
        System.setProperty(LsdProperties.GENERATED_AT, " 2026-01-01T12:00:00Z ")
        assertEquals("2026-01-01T12:00:00Z", LsdProperties.generatedAt().toString())
        System.setProperty(LsdProperties.GENERATED_AT, "")
        assertNull(LsdProperties.generatedAt())
    }
}
