package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.properties.LsdConfig
import io.lsdconsulting.lsd.mono.core.properties.LsdKey
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.net.URLClassLoader
import java.nio.file.Path
import java.util.Properties
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger
import kotlin.io.path.writeText

/**
 * Where values come from (system property > environment > configuration source >
 * `lsd-mono.properties` > default) and how booleans are read (#50). The environment cannot be
 * set from a test; it is looked up between the system property and the configuration source.
 */
@LsdTestConfig
class LsdConfigTest {
    @TempDir
    lateinit var tempDir: Path

    private val warnings = ArrayList<String>()
    private val handler =
        object : Handler() {
            override fun publish(record: LogRecord) {
                if (record.level == Level.WARNING) warnings += record.message
            }

            override fun flush() = Unit

            override fun close() = Unit
        }
    private val logger = Logger.getLogger(LsdConfig::class.java.name)
    private val keys = listOf(LsdProperties.LABEL_MAX_WIDTH, "lsd.core.label.maxWidth", LsdProperties.METRICS_ENABLED, LsdProperties.PAYLOAD_REDACT)

    @BeforeEach
    fun setUp() {
        keys.forEach(System::clearProperty)
        logger.addHandler(handler)
    }

    @AfterEach
    fun tearDown() {
        logger.removeHandler(handler)
    }

    private fun file(vararg entries: Pair<String, String>) = LsdConfig.resetForTests(Properties().apply { entries.forEach { (k, v) -> setProperty(k, v) } })

    @Test
    @OptIn(InternalLsdApi::class)
    fun `system property beats the configuration source, which beats the file, which beats the default`() {
        assertEquals("200", LsdKey.LABEL_MAX_WIDTH.value())

        file(LsdProperties.LABEL_MAX_WIDTH to "120")
        assertEquals(120, LsdProperties.labelMaxWidth())

        LsdProperties.useConfigurationSource { key -> if (key == LsdProperties.LABEL_MAX_WIDTH) "90" else null }
        assertEquals(90, LsdProperties.labelMaxWidth())

        System.setProperty(LsdProperties.LABEL_MAX_WIDTH, "60")
        assertEquals(60, LsdProperties.labelMaxWidth())

        LsdProperties.useConfigurationSource(null)
        System.clearProperty(LsdProperties.LABEL_MAX_WIDTH)
        assertEquals(120, LsdProperties.labelMaxWidth())
    }

    @Test
    fun `a key set in the file beats its legacy name set as a system property`() {
        file(LsdProperties.LABEL_MAX_WIDTH to "120")
        System.setProperty("lsd.core.label.maxWidth", "80")
        assertEquals(120, LsdProperties.labelMaxWidth())

        file("lsd.core.label.maxWidth" to "70")
        System.clearProperty("lsd.core.label.maxWidth")
        assertEquals(70, LsdProperties.labelMaxWidth(), "the legacy name is read from the file too")
    }

    @Test
    fun `lsd-mono properties is read from the classpath`() {
        tempDir.resolve("lsd-mono.properties").writeText("lsd.mono.label.maxWidth = 42\n")
        URLClassLoader(arrayOf(tempDir.toUri().toURL()), null).use { loader ->
            assertEquals("42", LsdConfig.load(loader).getProperty(LsdProperties.LABEL_MAX_WIDTH))
        }
        URLClassLoader(arrayOf(), null).use { empty -> assertTrue(LsdConfig.load(empty).isEmpty) }
    }

    @Test
    fun `booleans accept the usual spellings in any case`() {
        listOf("true", "TRUE", "yes", "Yes", "on", "1", " true ").forEach {
            System.setProperty(LsdProperties.METRICS_ENABLED, it)
            assertTrue(LsdKey.METRICS_ENABLED.boolean(), it)
        }
        listOf("false", "No", "OFF", "0").forEach {
            System.setProperty(LsdProperties.METRICS_ENABLED, it)
            assertFalse(LsdKey.METRICS_ENABLED.boolean(), it)
        }
        assertTrue(warnings.isEmpty(), warnings.toString())
    }

    @Test
    fun `an unrecognised boolean is warned about once and the default is used`() {
        System.setProperty(LsdProperties.METRICS_ENABLED, "nope")
        assertTrue(LsdKey.METRICS_ENABLED.boolean(), "default true, not false")
        assertTrue(LsdKey.METRICS_ENABLED.boolean())
        System.setProperty(LsdProperties.PAYLOAD_REDACT, "flase")
        assertTrue(LsdProperties.redactDefaults(), "a typo keeps redaction on")

        assertEquals(2, warnings.size, warnings.toString())
        assertTrue(warnings[0].contains("'nope'") && warnings[0].contains(LsdProperties.METRICS_ENABLED), warnings[0])
        assertTrue(warnings[1].contains("'flase'"), warnings[1])
    }
}
