package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.net.URI
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.logging.Handler
import java.util.logging.LogRecord
import java.util.logging.Logger
import kotlin.concurrent.thread

/** Carrying a scenario across threads and processes safely (#45). */
class ScenarioPropagationTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun output() {
        System.setProperty(LsdProperties.OUTPUT_DIR, tempDir.toString())
    }

    @AfterEach
    fun clearProperties() {
        System.clearProperty(LsdProperties.OUTPUT_DIR)
        System.clearProperty(LsdProperties.PROPAGATION_ALLOWED_HOSTS)
        System.clearProperty(LsdProperties.INHERIT_BINDING)
    }

    private fun LsdScenario.labels(): List<String> = close().second.map { (it as Message).label }

    private fun runOn(block: () -> Unit) = thread { block() }.join()

    @Test
    fun `the header carries an opaque correlation id, never the scenario key`() {
        val lsd = LsdContext()
        val scenario = lsd.beginScenario(key = "[engine:junit-jupiter]/[class:com.example.SecretProjectTest]/[method:charges()]")
        val other = lsd.beginScenario(bindCurrentThread = false)
        val value = lsd.scenarioHeaderValue("localhost")!!
        assertEquals(scenario.correlationId, value)
        assertTrue(Regex("[0-9a-f]{32}").matches(value), value)
        assertFalse(value.contains("Secret"))
        assertNotEquals(scenario.correlationId, other.correlationId)
        assertSame(scenario, lsd.findScenarioByHeader(" $value "))
        assertSame(other, lsd.findScenarioByHeader(other.correlationId))
        assertNull(lsd.findScenarioByHeader(scenario.key), "the key is not a header value")
        assertNull(lsd.findScenarioByHeader(null))
        scenario.complete("done")
        assertNull(lsd.findScenarioByHeader(value), "a finished scenario is not found")
    }

    @Test
    fun `only allowed hosts get the header, loopback by default`() {
        val lsd = LsdContext()
        assertNull(lsd.scenarioHeaderValue("localhost"), "no scenario, no header")
        val scenario = lsd.beginScenario()
        for (host in listOf("localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]")) {
            assertEquals(scenario.correlationId, lsd.scenarioHeaderValue(host), host)
        }
        assertEquals(scenario.correlationId, lsd.scenarioHeaderValue(URI("http://localhost:8080/orders")))
        assertNull(lsd.scenarioHeaderValue("api.stripe.com"))
        assertNull(lsd.scenarioHeaderValue(URI("https://api.stripe.com/v1/charges")))
        assertNull(lsd.scenarioHeaderValue(URI("mailto:someone@example.com")), "no host, no header")

        System.setProperty(LsdProperties.PROPAGATION_ALLOWED_HOSTS, "orders.test, *.internal.example")
        assertEquals(scenario.correlationId, lsd.scenarioHeaderValue("orders.test"))
        assertEquals(scenario.correlationId, lsd.scenarioHeaderValue("db.eu.internal.example"))
        assertNull(lsd.scenarioHeaderValue("internal.example"), "*.domain does not match the domain itself")
        assertNull(lsd.scenarioHeaderValue("localhost"), "the property replaces the default")
        assertNull(lsd.scenarioHeaderValue("evilinternal.example"))

        System.setProperty(LsdProperties.PROPAGATION_ALLOWED_HOSTS, "*")
        assertEquals(scenario.correlationId, lsd.scenarioHeaderValue("anything.example.com"))
        System.setProperty(LsdProperties.PROPAGATION_ALLOWED_HOSTS, "")
        assertNull(lsd.scenarioHeaderValue("localhost"), "an empty list allows nothing")
    }

    @Test
    fun `a thread started by a bound thread inherits its scenario while it runs`() {
        val lsd = LsdContext()
        val first = lsd.beginScenario(reportKey = "r", bindCurrentThread = false)
        val second = lsd.beginScenario(reportKey = "r")
        lateinit var child: Thread
        val ready = java.util.concurrent.CountDownLatch(1)
        val go = java.util.concurrent.CountDownLatch(1)
        child =
            thread {
                lsd.message("Worker", "Db", "from child")
                ready.countDown()
                go.await()
                // The scenario it inherited has finished: back to the usual rules (two running: default).
                lsd.message("Worker", "Db", "after the parent's scenario ended")
            }
        ready.await()
        second.bind().use { } // the parent re-binding does not matter to the child
        first.bind().use { runOn { lsd.message("Other", "Db", "from first's child") } }
        val third = lsd.beginScenario(reportKey = "r", bindCurrentThread = false)
        assertEquals(listOf("from child"), second.labels())
        lsd.discard(second)
        go.countDown()
        child.join()
        assertEquals(listOf("from first's child"), first.labels())
        assertTrue(third.labels().isEmpty())
    }

    private fun LsdContext.discard(scenario: LsdScenario) = scenario.discard()

    @Test
    fun `a binding made on the child thread wins over the inherited one`() {
        val lsd = LsdContext()
        val parent = lsd.beginScenario()
        val own = lsd.beginScenario(bindCurrentThread = false)
        runOn { own.bind().use { lsd.message("A", "B", "own") } }
        assertEquals(listOf("own"), own.labels())
        assertTrue(parent.labels().isEmpty())
    }

    @Test
    fun `pool threads never inherit, even when the pool starts them during a test`() {
        val lsd = LsdContext()
        val first = lsd.beginScenario(reportKey = "r")
        val second = lsd.beginScenario(reportKey = "r", bindCurrentThread = false)
        val pool = Executors.newFixedThreadPool(2)
        try {
            // The pool creates its thread now, from a thread bound to `first`.
            pool.submit { lsd.message("Pool", "Db", "pooled") }.get(5, TimeUnit.SECONDS)
            CompletableFuture.runAsync { lsd.message("Pool", "Db", "common pool") }.get(5, TimeUnit.SECONDS)
            pool.submit(lsd.wrap(Runnable { lsd.message("Pool", "Db", "wrapped") })).get(5, TimeUnit.SECONDS)
        } finally {
            pool.shutdownNow()
        }
        assertEquals(listOf("wrapped"), first.labels(), "only wrapped work is attributed")
        assertTrue(second.labels().isEmpty())
    }

    @Test
    fun `inheritance can be turned off`() {
        System.setProperty(LsdProperties.INHERIT_BINDING, "false")
        val lsd = LsdContext()
        val first = lsd.beginScenario(reportKey = "r")
        val second = lsd.beginScenario(reportKey = "r", bindCurrentThread = false)
        runOn { lsd.message("Worker", "Db", "not inherited") }
        assertTrue(first.labels().isEmpty())
        assertTrue(second.labels().isEmpty())
    }

    @Test
    fun `completeReport warns about scenarios of that report that are still running`() {
        val records = ArrayList<LogRecord>()
        val handler =
            object : Handler() {
                override fun publish(record: LogRecord) {
                    records += record
                }

                override fun flush() = Unit

                override fun close() = Unit
            }
        val logger = Logger.getLogger(LsdContext::class.java.name)
        logger.addHandler(handler)
        try {
            val lsd = LsdContext()
            lsd.beginScenario(reportKey = "orders", key = "forgotten", bindCurrentThread = false)
            lsd.beginScenario(reportKey = "payments", key = "other report", bindCurrentThread = false)
            val done = lsd.beginScenario(reportKey = "orders", bindCurrentThread = false)
            done.complete("done")
            lsd.completeReport("Orders", reportKey = "orders")
            val warning = records.map { it.message }.single { it.contains("still running") }
            assertTrue(warning.contains("'forgotten'"), warning)
            assertFalse(warning.contains("other report"), "scenarios of other reports are not this report's business")

            records.clear()
            lsd.completeReport("Payments again", reportKey = "nothing-running")
            assertTrue(records.none { it.message.contains("still running") })
        } finally {
            logger.removeHandler(handler)
        }
    }
}
