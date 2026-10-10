package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.properties.LsdKey
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Path
import kotlin.io.path.readLines

/** The [LsdKey] table: legacy fallbacks, defaults, and the README table that documents it. */
class LsdPropertiesTest {
    private val names = LsdKey.entries.flatMap { listOfNotNull(it.key, it.legacy) }
    private val saved = names.associateWith { System.getProperty(it) }

    @AfterEach
    fun restore() {
        saved.forEach { (key, value) -> if (value == null) System.clearProperty(key) else System.setProperty(key, value) }
    }

    @Test
    fun `every key prefers its mono name, then its legacy name, then its default`() {
        LsdKey.entries.forEach { key ->
            System.clearProperty(key.key)
            key.legacy?.let(System::clearProperty)
            assertEquals(key.default, key.value(), key.key)
            key.legacy?.let { legacy ->
                System.setProperty(legacy, "legacy")
                assertEquals("legacy", key.value(), legacy)
            }
            System.setProperty(key.key, "mono")
            assertEquals("mono", key.value(), key.key)
        }
    }

    @Test
    fun `the README lists every key with its legacy name and default`() {
        val rows =
            Path
                .of("README.md")
                .readLines()
                .filter { it.startsWith("| `lsd.mono.") }
                .map { line -> line.split('|').map { it.trim().removeSurrounding("`") } }
                .filter { it.size == 6 }
                .map { Triple(it[1], it[2].ifEmpty { null }, it[3].takeUnless { cell -> cell == "unset" }) }
        assertEquals(LsdKey.entries.map { Triple(it.key, it.legacy, it.default) }, rows)
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
        val limits = io.lsdconsulting.lsd.mono.core.PayloadConverters.Limits
            .fromProperties()
        assertEquals(7, limits.maxDepth)
        assertEquals(1000, limits.maxItems)
        assertEquals(1_000_000, limits.maxTotalSize)
        assertEquals(100_000, limits.maxStringLength)
    }

    @Test
    fun `a scenario error carries the cause's message and stack unless stack traces are hidden`() {
        System.clearProperty(LsdProperties.HIDE_STACKTRACE)
        System.clearProperty("lsd.junit.hideStacktrace")
        val cause = IllegalStateException("boom")
        val shown = ScenarioError.of("Failed", cause)
        assertEquals("Failed", shown.headline)
        assertEquals("boom", shown.message)
        assertEquals(cause.stackTraceToString(), shown.stack)

        System.setProperty("lsd.junit.hideStacktrace", "true")
        assertEquals(ScenarioError("Failed", "boom", ScenarioError.HIDDEN_STACK), ScenarioError.of("Failed", cause))

        System.clearProperty("lsd.junit.hideStacktrace")
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
