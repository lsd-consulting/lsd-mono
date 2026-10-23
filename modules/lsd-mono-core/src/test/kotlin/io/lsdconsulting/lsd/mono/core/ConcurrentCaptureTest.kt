package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
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
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.io.path.listDirectoryEntries

/**
 * Many threads capturing at once (#24). The first test uses only the long-standing
 * API, so it also shows what went wrong before capture was made thread-safe (it threw
 * ConcurrentModificationException). The rest cover scenario scopes and report keys.
 */
@LsdTestConfig(deterministicIds = true)
class ConcurrentCaptureTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `captures from many threads into one scenario are neither lost nor duplicated`() {
        val lsd = LsdContext()
        val threads = 8
        val perThread = 2_000
        runConcurrently(threads) { t ->
            repeat(perThread) { i ->
                // A new participant name per thread and a shared one, so the registry is written concurrently too.
                lsd.message("Client $t", "Service ${i % 50}", "t$t-$i")
                if (i % 100 == 0) lsd.addFact("thread $t", "$i")
            }
        }
        lsd.completeScenario("stress")
        lsd.completeReport("Concurrent capture")

        val scenario = ReportJson.single(tempDir, "Concurrent-capture*-report.json").scenario("stress")
        val labels = scenario.labels
        assertEquals(threads * perThread, labels.size, "lost or extra events")
        assertEquals(labels.size, labels.toSet().size, "duplicated events")
        val ids = listOfNotNull(scenario["id"]) + scenario.events.mapNotNull { it["id"] }
        assertEquals(threads * perThread + 1, ids.size, "every event and the scenario has an id")
        assertEquals(ids.size, ids.toSet().size, "duplicate ids")
        val facts = scenario.facts.count { it.first.startsWith("thread ") }
        assertEquals(threads * (perThread / 100), facts, "lost facts")
        val participants = scenario.participants.mapNotNull { it.string("name") }.filter { it.startsWith("Client ") || it.startsWith("Service ") }
        assertEquals(threads + 50, participants.size, "each name should be registered once: $participants")
        assertEquals(participants.size, participants.toSet().size)
    }

    @Test
    fun `scenarios running on different threads keep their own events and facts`() {
        val lsd = LsdContext()
        val threads = 8
        val perThread = 500
        val barrier = CyclicBarrier(threads)
        runConcurrently(threads) { t ->
            lsd.beginScenario(reportKey = "suite")
            barrier.await(30, TimeUnit.SECONDS)
            lsd.addFact("owner", "s$t")
            repeat(perThread) { i ->
                lsd.message("Client", "Service", "s$t-$i")
                if (i % 50 == 0) Thread.yield()
            }
            barrier.await(30, TimeUnit.SECONDS)
            lsd.completeScenario("scenario $t")
        }
        lsd.completeReport("Isolated", reportKey = "suite")

        val report = readReport("Isolated", "suite")
        (0 until threads).forEach { t ->
            val scenario = report.scenario("scenario $t")
            val owners = scenario.labels.map { it.substringBefore("-") }
            assertEquals(perThread, owners.size, "scenario $t lost or gained events")
            assertEquals(setOf("s$t"), owners.toSet(), "scenario $t has another thread's events")
            val facts = scenario.facts.filter { it.first == "owner" }
            assertTrue(("owner" to "s$t") in facts, "scenario $t lost its fact")
            assertEquals(1, facts.size, "scenario $t has another thread's facts")
        }
    }

    @Test
    fun `wrapped work on a pool thread is attributed to the scenario that submitted it`() {
        val lsd = LsdContext()
        val pool = Executors.newFixedThreadPool(2)
        try {
            val starts = CountDownLatch(2)
            runConcurrently(2) { t ->
                lsd.beginScenario(reportKey = "pool")
                starts.countDown()
                starts.await(30, TimeUnit.SECONDS)
                lsd.message("Test $t", "Service", "direct-$t")
                // A plain submit would run unbound; wrap carries this thread's scenario across.
                pool.submit(lsd.wrap { lsd.message("Service", "Worker", "pooled-$t") }).get(30, TimeUnit.SECONDS)
                lsd.currentScenario()!!.capture(Message(id = "", from = "Worker", to = "Service", label = "explicit-$t"))
                lsd.completeScenario("pool $t")
            }
        } finally {
            pool.shutdownNow()
        }
        lsd.completeReport("Pool", reportKey = "pool")
        val report = readReport("Pool", "pool")
        listOf(0, 1).forEach { t ->
            assertEquals(setOf("direct-$t", "pooled-$t", "explicit-$t"), report.scenario("pool $t").labels.toSet())
        }
    }

    @Test
    fun `an unbound thread captures into the only running scenario, as single-threaded runs did`() {
        val lsd = LsdContext()
        lsd.beginScenario(reportKey = "one")
        val server = Thread { lsd.message("Server", "Db", "from server thread") }
        server.start()
        server.join()
        lsd.completeScenario("only one")
        lsd.completeReport("One", reportKey = "one")
        assertTrue("from server thread" in readReport("One", "one").scenario("only one").labels)
    }

    @Test
    fun `with several scenarios running an unbound capture is not given to either`() {
        val lsd = LsdContext()
        val first = lsd.beginScenario(reportKey = "r", bindCurrentThread = false)
        val second = lsd.beginScenario(reportKey = "r", bindCurrentThread = false)
        val stray = Thread { lsd.message("Stray", "Service", "ambiguous") }
        stray.start()
        stray.join()
        first.capture(Message(id = "", from = "A", to = "B", label = "first"))
        second.capture(Message(id = "", from = "A", to = "B", label = "second"))
        first.complete("first")
        second.complete("second")
        // It stays in the default scenario, where single-threaded code would complete it.
        lsd.completeScenario("default")
        lsd.completeReport("Ambiguous", reportKey = "r")
        val running = readReport("Ambiguous", "r").scenarios
        assertEquals(listOf("first", "second"), running.map { it.title }.sorted())
        assertFalse(running.any { "ambiguous" in it.labels }, "an unattributable capture must not land in a running scenario")
        lsd.completeReport("Default")
        assertTrue("ambiguous" in readReport("Default", null).scenario("default").labels)
    }

    @Test
    fun `report keys keep parallel suites in separate reports even with the same title`() {
        val lsd = LsdContext()
        val suites = 6
        runConcurrently(suites) { t ->
            repeat(3) { n ->
                lsd.beginScenario(reportKey = "com.example.pkg$t.OrderTest")
                lsd.message("Client", "Service", "suite$t-$n")
                lsd.completeScenario("test $n")
            }
            lsd.completeReport("OrderTest", reportKey = "com.example.pkg$t.OrderTest")
            lsd.createIndex()
        }
        val reports = tempDir.listDirectoryEntries("OrderTest-*-report.json")
        assertEquals(suites, reports.size, "same title, different keys must not overwrite: ${reports.map { it.fileName }}")
        (0 until suites).forEach { t ->
            val owners = readReport("OrderTest", "com.example.pkg$t.OrderTest").scenarios.flatMap { it.labels }.map { it.substringBefore("-") }
            assertEquals(List(3) { "suite$t" }, owners)
        }
        val index = ReportJson.index(tempDir)
        val pages = Regex("OrderTest-[0-9a-f]{8}-diagram.html")
        assertEquals(suites, index.objects("reports").count { pages.matches(it.string("href").orEmpty()) }, index.toString())
    }

    @Test
    fun `a capture after its scenario completed is dropped, not given to the next one`() {
        val lsd = LsdContext()
        val first = lsd.beginScenario(reportKey = "late")
        first.complete("first")
        first.capture(Message(id = "", from = "A", to = "B", label = "too late"))
        first.complete("first again")
        lsd.beginScenario(reportKey = "late")
        lsd.message("A", "B", "on time")
        lsd.completeScenario("second")
        lsd.completeReport("Late", reportKey = "late")
        val report = readReport("Late", "late")
        assertFalse(report.scenarios.any { "too late" in it.labels })
        assertFalse("first again" in report.titles, "a second complete does nothing")
        assertTrue("on time" in report.scenario("second").labels)
    }

    @Test
    fun `beginScenario takes over unbound captures made while nothing was running`() {
        val lsd = LsdContext()
        lsd.message("Setup", "Db", "seed data")
        lsd.addFact("env", "test")
        lsd.beginScenario(reportKey = "k")
        lsd.message("Test", "Api", "call")
        lsd.completeScenario("first test")
        lsd.completeReport("Setup", reportKey = "k")
        val scenario = readReport("Setup", "k").scenario("first test")
        assertEquals(listOf("seed data", "call"), scenario.labels, scenario.toString())
        assertTrue(scenario.facts.any { it.first == "env" })
    }

    @Test
    fun `scenario keys must be unique while running and clear forgets running scenarios`() {
        val lsd = LsdContext()
        val running = lsd.beginScenario(key = "same")
        assertSame(running, lsd.findScenario("same"))
        assertThrows(IllegalStateException::class.java) { lsd.beginScenario(key = "same") }
        lsd.clear()
        assertFalse(running.isActive)
        assertNull(lsd.currentScenario())
        assertNull(lsd.findScenario("same"))
    }

    private fun readReport(title: String, reportKey: String?): ReportJson =
        ReportJson.read(tempDir.resolve(ReportFileNames.stem(title, reportKey) + "-report.json"))

    private fun runConcurrently(threads: Int, body: (Int) -> Unit) {
        val pool = Executors.newFixedThreadPool(threads)
        val start = CountDownLatch(1)
        try {
            val futures = (0 until threads).map { t ->
                pool.submit {
                    start.await()
                    body(t)
                }
            }
            start.countDown()
            futures.forEach { it.get(60, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }
    }
}
