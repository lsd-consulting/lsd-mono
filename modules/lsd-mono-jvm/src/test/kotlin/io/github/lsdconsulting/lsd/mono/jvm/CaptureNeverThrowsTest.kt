package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.NoteSide
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger
import kotlin.io.path.readText

/**
 * What an interceptor calls never throws into the application under test; misusing the
 * test DSL still does (#49).
 */
@LsdTestConfig
class CaptureNeverThrowsTest {
    @TempDir
    lateinit var tempDir: Path

    private val records = ArrayList<LogRecord>()
    private val handler =
        object : Handler() {
            override fun publish(record: LogRecord) {
                synchronized(records) { records += record }
            }

            override fun flush() = Unit

            override fun close() = Unit
        }
    private val logger = Logger.getLogger(LsdContext::class.java.name)

    /** A payload whose converter fails with an error the payload walker does not expect. */
    class Bomb

    /** An exception whose message cannot be read, as a lazily built message might fail. */
    class UnreadableException : RuntimeException() {
        override val message: String
            get() = throw IllegalStateException("message is broken")
    }

    private val lsd = LsdContext()

    @BeforeEach
    fun setUp() {
        logger.addHandler(handler)
        lsd.payloads.register<Bomb> { throw AssertionError("converter bug") }
    }

    @AfterEach
    fun tearDown() {
        logger.removeHandler(handler)
    }

    private fun warnings() = synchronized(records) { records.filter { it.level == Level.WARNING }.map { it.message } }

    @Test
    fun `a failing capture is dropped with one warning per kind and the rest of the scenario is kept`() {
        lsd.scenario("robust") {
            message("Shop", "Orders", "kept before")
            message("Shop", "Orders", "dropped", data = Bomb())
            async("Orders", "Events", "also dropped", data = Bomb())
            message("Orders", "Shop", "kept after")
        }
        val json = lsd.completeReport("Robust").reportJson.readText()

        assertTrue(json.contains("kept before") && json.contains("kept after"), json)
        assertFalse(json.contains("dropped"), json)
        val dropped = warnings().filter { it.contains("dropped (event)") }
        assertEquals(1, dropped.size, "warned once for the kind, then DEBUG: ${warnings()}")
        assertTrue(dropped.single().contains("converter bug"), dropped.single())
    }

    @Test
    fun `a call and its reply survive failures, including on another scenario's thread`() {
        val scenario = lsd.beginScenario(key = "calls", bindCurrentThread = false)
        val call = scenario.call("Shop", "Payments", "POST /pay", data = Bomb())
        call.fail(UnreadableException())
        call.reply("200 OK")

        val failed = lsd.call("Shop", "Payments", "GET /status")
        failed.reply("ok", data = Bomb())
        assertTrue(warnings().any { it.contains("dropped (reply)") && it.contains("message is broken") }, warnings().toString())
    }

    @Test
    fun `the scenario header helpers and lookup do not throw`() {
        assertEquals(null, lsd.scenarioHeaderValue(java.net.URI("mailto:someone@example.com")))
        assertEquals(null, lsd.findScenarioByHeader("  "))
    }

    @Test
    fun `an out of memory error is not swallowed`() {
        lsd.payloads.register<Bomb> { throw OutOfMemoryError("pretend") }
        assertThrows(OutOfMemoryError::class.java) { lsd.message("A", "B", data = Bomb()) }
    }

    @Test
    fun `misusing the test DSL still throws`() {
        assertThrows(IllegalArgumentException::class.java) { lsd.note("over nobody", on = null, side = NoteSide.OVER) }

        var escaped: CaptureBlock? = null
        lsd.capture { escaped = this }
        assertThrows(IllegalStateException::class.java) { escaped!!.message("A", "B") }

        lsd.beginScenario(key = "twice", bindCurrentThread = false)
        assertThrows(IllegalStateException::class.java) { lsd.beginScenario(key = "twice", bindCurrentThread = false) }
    }
}
