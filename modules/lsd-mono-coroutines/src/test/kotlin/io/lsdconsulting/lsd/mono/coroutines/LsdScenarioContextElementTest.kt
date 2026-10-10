package io.lsdconsulting.lsd.mono.coroutines

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.yield
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.readText

/**
 * A scenario bound with a plain thread binding is lost when a coroutine resumes on another
 * thread (#38). These tests run coroutines across `Dispatchers.Default` and `Dispatchers.IO`.
 *
 * Every test keeps two scenarios running. With only one running scenario, a capture from
 * an unbound thread is given to it anyway, so a test could pass without the binding working.
 */
class LsdScenarioContextElementTest {
    @TempDir
    lateinit var tempDir: Path

    private val lsd = LsdContext()

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
    }

    @AfterEach
    fun restore() {
        lsd.clear()
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
    }

    /** A running scenario that is not bound to the calling thread. */
    private fun running(reportKey: String): LsdScenario = lsd.beginScenario(reportKey = reportKey, bindCurrentThread = false)

    /** Complete [scenario] and return the labels of the messages in its report, in order. */
    private fun labelsOf(scenario: LsdScenario): List<String> {
        val reportKey = checkNotNull(scenario.reportKey)
        scenario.complete(reportKey)
        val json = lsd.completeReport(reportKey, reportKey).reportJson.readText()
        return Regex(""""label": "([^"]*)"""").findAll(json).map { it.groupValues[1] }.toList()
    }

    @Test
    fun `a scenario follows its coroutine across dispatcher hops`() {
        val scenario = running("hops")
        val bystander = running("bystander")
        val seen = mutableListOf<LsdScenario?>()

        runBlocking {
            withLsdScenario(scenario) {
                lsd.message("Client", "Orders", "start")
                withContext(Dispatchers.Default) {
                    seen += lsd.currentScenario()
                    lsd.message("Orders", "Db", "default")
                    delay(5)
                    seen += lsd.currentScenario()
                    lsd.message("Orders", "Db", "default after delay")
                }
                withContext(Dispatchers.IO) {
                    seen += lsd.currentScenario()
                    lsd.message("Orders", "Queue", "io")
                }
                lsd.message("Orders", "Client", "end")
            }
        }

        assertEquals(listOf(scenario, scenario, scenario), seen)
        assertEquals(listOf("start", "default", "default after delay", "io", "end"), labelsOf(scenario))
        assertEquals(emptyList<String>(), labelsOf(bystander), "the other running scenario got nothing")
    }

    @Test
    fun `coroutines of different scenarios running in parallel never mix`() {
        val first = running("first")
        val second = running("second")
        val coroutines = 40
        val steps = 30

        runBlocking(Dispatchers.Default) {
            listOf(first to "a", second to "b")
                .map { (scenario, tag) ->
                    async {
                        withLsdScenario(scenario) {
                            coroutineScope {
                                repeat(coroutines) { n ->
                                    launch {
                                        repeat(steps) { s ->
                                            lsd.message("Client", "Service", "$tag-$n-$s")
                                            when (s % 3) {
                                                0 -> yield()
                                                1 -> withContext(Dispatchers.IO) { delay(1) }
                                                else -> delay(1)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }.awaitAll()
        }

        listOf(first to "a", second to "b").forEach { (scenario, tag) ->
            val labels = labelsOf(scenario)
            assertEquals(coroutines * steps, labels.size, "scenario $tag lost or gained events")
            assertEquals(labels.size, labels.toSet().size, "scenario $tag has duplicated events")
            assertEquals(setOf(tag), labels.map { it.substringBefore('-') }.toSet(), "scenario $tag has the other scenario's events")
        }
    }

    @Test
    fun `child coroutines inherit the scenario`() {
        val scenario = running("children")
        val bystander = running("bystander")

        runBlocking {
            withLsdScenario(scenario) {
                coroutineScope {
                    launch(Dispatchers.IO) { lsd.message("A", "B", "launched on io") }
                    async(Dispatchers.Default) { lsd.message("A", "B", "async on default") }.await()
                }
            }
        }

        assertEquals(setOf("launched on io", "async on default"), labelsOf(scenario).toSet())
        assertEquals(emptyList<String>(), labelsOf(bystander))
    }

    @Test
    fun `the element works with launch and plus, and returns the block's value`() {
        val scenario = running("plus")
        val bystander = running("bystander")

        val answer =
            runBlocking {
                launch(scenario.asContextElement() + Dispatchers.Default) { lsd.message("A", "B", "launched with the element") }.join()
                withContext(scenario.asContextElement() + Dispatchers.IO) { lsd.message("A", "B", "withContext with the element") }
                withLsdScenario(scenario) { 42 }
            }

        assertEquals(42, answer)
        assertEquals(listOf("launched with the element", "withContext with the element"), labelsOf(scenario))
        assertEquals(emptyList<String>(), labelsOf(bystander))
    }

    @Test
    fun `a nested scenario shadows the outer one and the outer comes back`() {
        val outer = running("outer")
        val inner = running("inner")

        runBlocking {
            withLsdScenario(outer) {
                assertSame(outer, lsd.currentScenario())
                withLsdScenario(inner) {
                    assertSame(inner, lsd.currentScenario())
                    withContext(Dispatchers.Default) { assertSame(inner, lsd.currentScenario()) }
                }
                assertSame(outer, lsd.currentScenario())
                withContext(Dispatchers.Default) { assertSame(outer, lsd.currentScenario()) }
            }
        }
    }

    @Test
    fun `the calling thread's own binding is restored afterwards`() {
        val own = lsd.beginScenario(reportKey = "own")
        val other = running("other")

        runBlocking {
            withLsdScenario(other) {
                assertSame(other, lsd.currentScenario())
            }
            assertSame(own, lsd.currentScenario(), "the thread is bound to what it was before")
        }
    }

    @Test
    fun `pool threads are left unbound when the coroutine ends`() {
        val scenario = running("pool")
        running("bystander")

        runBlocking {
            withLsdScenario(scenario) {
                withContext(Dispatchers.Default) { delay(1) }
                withContext(Dispatchers.IO) { delay(1) }
            }
            assertNoBindingOnPoolThreads()
        }
    }

    @Test
    fun `bindings are restored when the block throws`() {
        val scenario = running("throws")
        running("bystander")

        assertThrows<IllegalStateException> {
            runBlocking {
                withLsdScenario(scenario) {
                    withContext(Dispatchers.Default) { delay(1) }
                    error("boom")
                }
            }
        }

        assertNull(lsd.currentScenario())
        runBlocking { assertNoBindingOnPoolThreads() }
    }

    @Test
    fun `bindings are restored when the block is cancelled`() {
        val scenario = running("cancelled")
        running("bystander")

        runBlocking {
            val result = withTimeoutOrNull(30) { withLsdScenario(scenario) { withContext(Dispatchers.Default) { delay(60_000) } } }
            assertNull(result, "the block was cancelled by the timeout")
            assertNull(lsd.currentScenario())
            assertNoBindingOnPoolThreads()
        }
    }

    @Test
    fun `the element names its scenario, to read in a coroutine context dump`() {
        val scenario = running("named")

        assertEquals("LsdScenarioElement(${scenario.key})", scenario.asContextElement().toString())
    }

    /** What the module is for: a thread binding alone does not survive a dispatcher hop. */
    @Test
    fun `a plain thread binding is lost when the coroutine changes thread`() {
        val scenario = running("plain")
        running("bystander")

        scenario.bind().use {
            assertSame(scenario, lsd.currentScenario())
            runBlocking {
                withContext(Dispatchers.Default) { assertNull(lsd.currentScenario()) }
            }
        }
    }

    private suspend fun assertNoBindingOnPoolThreads() {
        repeat(50) {
            withContext(Dispatchers.Default) { assertNull(lsd.currentScenario()) }
            withContext(Dispatchers.IO) { assertNull(lsd.currentScenario()) }
        }
    }
}
