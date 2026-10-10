package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.io.path.exists
import kotlin.io.path.readText

/** `scenario { }`, `report { }` and `wrap(Callable)`: binding, nesting, failures and parallel reports. */
class ScopedBlocksTest {
    @TempDir
    lateinit var tempDir: Path

    private val lsd = LsdContext()

    @BeforeEach
    fun output() {
        System.setProperty(LsdProperties.OUTPUT_DIR, tempDir.toString())
        System.setProperty(LsdProperties.DETERMINISTIC_IDS, "true")
    }

    @AfterEach
    fun clearProperties() {
        System.clearProperty(LsdProperties.OUTPUT_DIR)
        System.clearProperty(LsdProperties.DETERMINISTIC_IDS)
    }

    private fun json(title: String, reportKey: String? = null): String =
        tempDir.resolve(ReportWriter.reportFileStem(title, reportKey) + "-report.json").readText()

    /** The labels of each scenario in a report, by scenario title, in report order. */
    private fun labelsByScenario(json: String): Map<String, List<String>> {
        val titles = Regex(""""title": "([^"]*)"""").findAll(json).toList().drop(1) // the first is the report's
        return titles.withIndex().associate { (i, title) ->
            val end = titles.getOrNull(i + 1)?.range?.first ?: json.length
            val slice = json.substring(title.range.last, end)
            title.groupValues[1] to Regex(""""label": "([^"]*)"""").findAll(slice).map { it.groupValues[1] }.toList()
        }
    }

    @Test
    fun `scenario binds the thread, completes as a success and returns the block's value`() {
        val value =
            lsd.scenario("Place an order", description = "Given stock") {
                assertSame(this, lsd.currentScenario())
                lsd.message("Customer", "Shop", "via the context")
                message("Shop", "Orders", "via the receiver")
                42
            }

        assertEquals(42, value)
        assertNull(lsd.currentScenario())
        lsd.completeReport("Shop")
        val json = json("Shop")
        assertEquals(mapOf("Place an order" to listOf("via the context", "via the receiver")), labelsByScenario(json))
        assertTrue(json.contains(""""status": "success""""), json)
        assertTrue(json.contains(""""description": "Given stock""""), json)
    }

    @Test
    fun `a nested scenario shadows the outer one and gives the binding back`() {
        val outer = lsd.beginScenario()
        lsd.message("A", "B", "outer before")
        lsd.scenario("Inner") {
            lsd.message("A", "B", "inner")
            lsd.scenario("Innermost") { lsd.message("A", "B", "innermost") }
            lsd.message("A", "B", "inner again")
        }
        assertSame(outer, lsd.currentScenario())
        lsd.message("A", "B", "outer after")
        outer.complete("Outer")
        lsd.completeReport("Nested")

        assertEquals(
            mapOf(
                "Outer" to listOf("outer before", "outer after"),
                "Inner" to listOf("inner", "inner again"),
                "Innermost" to listOf("innermost"),
            ),
            labelsByScenario(json("Nested")),
        )
    }

    @Test
    fun `a throwing block completes the scenario as an error and rethrows`() {
        val outer = lsd.beginScenario()
        val boom = IllegalStateException("out of stock")

        val thrown =
            assertThrows(IllegalStateException::class.java) {
                lsd.scenario("Card declined") {
                    lsd.message("Shop", "Payments", "charge")
                    throw boom
                }
            }

        assertSame(boom, thrown)
        assertSame(outer, lsd.currentScenario())
        outer.discard()
        lsd.completeReport("Errors")
        val json = json("Errors")
        assertEquals(mapOf("Card declined" to listOf("charge")), labelsByScenario(json))
        assertTrue(json.contains(""""status": "error""""), json)
        assertTrue(json.contains(""""headline": "Failed""""), json)
        assertTrue(json.contains(""""message": "out of stock""""), json)
    }

    @Test
    fun `report writes its scenarios, including ones started by code it calls`() {
        fun placeOrder() = lsd.scenario("From a helper") { lsd.message("Customer", "Shop", "helper") }

        lsd.beginScenario(reportKey = "elsewhere").also { it.message("X", "Y", "not mine") }
        val path =
            lsd.report("Online shop") {
                assertEquals("Online shop", key)
                scenario("Place an order") { capture { "Customer" calls "Shop" label "order" } }
                placeOrder()
            }

        assertTrue(path.diagramHtml.exists(), "$path")
        assertTrue(path.listingHtml.exists(), "$path")
        assertTrue(tempDir.resolve("index.html").exists())
        assertEquals(
            mapOf("Place an order" to listOf("order"), "From a helper" to listOf("helper")),
            labelsByScenario(json("Online shop", "Online shop")),
        )
    }

    @Test
    fun `a throwing report block still writes the report, then rethrows`() {
        val thrown =
            assertThrows(IllegalArgumentException::class.java) {
                lsd.report("Broken") {
                    scenario("Fine") { lsd.message("A", "B", "fine") }
                    scenario("Fails") { throw IllegalArgumentException("bad input") }
                }
            }

        assertEquals("bad input", thrown.message)
        val json = json("Broken", "Broken")
        assertEquals(mapOf("Fine" to listOf("fine"), "Fails" to emptyList<String>()), labelsByScenario(json))
        assertTrue(json.contains(""""message": "bad input""""), json)
    }

    @Test
    fun `parallel reports never mix scenarios, even with the same title`() {
        val threads = 6
        val pool = Executors.newFixedThreadPool(threads)
        val start = CountDownLatch(1)
        try {
            val paths =
                (1..threads)
                    .map { t ->
                        pool.submit<ReportFiles> {
                            start.await()
                            // Two reports per title, so keys must differ while both are open.
                            lsd.report("Shop ${(t + 1) / 2}") {
                                repeat(3) { s ->
                                    scenario("t$t s$s") {
                                        repeat(20) { i ->
                                            lsd.message("Client", "Shop", "t$t-$i")
                                            Thread.sleep(1)
                                        }
                                    }
                                }
                            }
                        }
                    }.also { start.countDown() }
                    .map { it.get(60, TimeUnit.SECONDS) }

            assertEquals(threads, paths.toSet().size, "every report gets its own file: $paths")
            paths.forEach { path ->
                val json = path.reportJson.readText()
                val scenarios = labelsByScenario(json)
                assertEquals(3, scenarios.size, "$path: ${scenarios.keys}")
                val owner = scenarios.keys.map { it.substringBefore(' ') }.toSet()
                assertEquals(1, owner.size, "$path mixes reports: ${scenarios.keys}")
                scenarios.values.forEach { labels ->
                    assertEquals(20, labels.size)
                    assertTrue(labels.all { it.startsWith("${owner.single()}-") }, "$path: $labels")
                }
            }
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `a report's scenarios can run on other threads`() {
        val pool = Executors.newFixedThreadPool(3)
        try {
            lsd.report("Fan out") {
                (1..3)
                    .map { n -> pool.submit { scenario("worker $n") { lsd.message("Pool", "Shop", "w$n") } } }
                    .forEach { it.get(30, TimeUnit.SECONDS) }
            }
        } finally {
            pool.shutdownNow()
        }
        assertEquals(
            setOf("worker 1" to listOf("w1"), "worker 2" to listOf("w2"), "worker 3" to listOf("w3")),
            labelsByScenario(json("Fan out", "Fan out")).toList().toSet(),
        )
    }

    @Test
    fun `wrap(Callable) carries the scenario to another thread and returns the value`() {
        val pool = Executors.newSingleThreadExecutor()
        try {
            lsd.scenario("Wrapped") {
                val result = pool
                    .submit(
                        lsd.wrap<String> {
                            lsd.message("Worker", "Db", "select")
                            "row"
                        },
                    ).get(30, TimeUnit.SECONDS)
                assertEquals("row", result)
                assertFalse(pool.submit<Boolean> { lsd.currentScenario() != null }.get(30, TimeUnit.SECONDS), "the worker is unbound again")
            }
        } finally {
            pool.shutdownNow()
        }
        lsd.completeReport("Wrap")
        assertEquals(mapOf("Wrapped" to listOf("select")), labelsByScenario(json("Wrap")))
    }
}
