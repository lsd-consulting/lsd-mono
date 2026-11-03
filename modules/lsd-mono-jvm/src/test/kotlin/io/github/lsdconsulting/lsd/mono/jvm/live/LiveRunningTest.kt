package io.github.lsdconsulting.lsd.mono.jvm.live

import io.github.lsdconsulting.lsd.mono.jvm.domain.Scenario
import io.github.lsdconsulting.lsd.mono.jvm.report.ReportJsonMapper
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.ServerSocket
import java.net.URI
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** A scenario sent as it runs is let go of on every way out, so nothing keeps its events alive. */
class LiveRunningTest {
    private val ids = AtomicInteger()

    private val warnings = CopyOnWriteArrayList<String>()

    private fun capture(
        url: String,
        connector: LiveConnector = JdkLiveConnector(Duration.ofSeconds(30)),
        queueCapacity: Int = 100,
        flushTimeout: Duration = Duration.ofSeconds(30),
    ) = LiveCapture(
        LiveFrames(ReportJsonMapper { "id${ids.incrementAndGet()}" }),
        url = { url },
        connector = connector,
        flushTimeout = flushTimeout,
        queueCapacity = queueCapacity,
        warn = warnings::add,
    )

    /** A socket that sends nowhere; [close] plays the server closing it with a code. */
    private class FakeConnector(
        private val entered: CountDownLatch = CountDownLatch(0),
        private val gate: CountDownLatch = CountDownLatch(0),
    ) : LiveConnector {
        @Volatile
        var close: (Int) -> Unit = {}

        override fun connect(
            uri: URI,
            onText: (String) -> Unit,
            onClose: (Int) -> Unit,
        ): LiveSocket {
            close = onClose
            entered.countDown()
            gate.await(30, TimeUnit.SECONDS)
            return object : LiveSocket {
                override fun send(text: String) {}

                override fun close() {}

                override fun abort() {}
            }
        }
    }

    private fun eventually(check: () -> Boolean) {
        val deadline = System.nanoTime() + 30_000_000_000
        while (!check() && System.nanoTime() < deadline) Thread.sleep(10)
        assertTrue(check())
    }

    private val nothingYet: (String) -> Scenario? = { null }

    @Test
    fun `a discarded scenario is let go of`() {
        TestStudio().use { studio ->
            val live = capture(studio.url)
            val scenario = Any()
            live.started("a", scenario, "Discarded", nothingYet)
            assertEquals(1, live.runningCount)
            live.discarded(scenario)
            assertEquals(0, live.runningCount)
            live.written("a")
        }
    }

    @Test
    fun `a scenario that never completes is let go of when its report is written`() {
        TestStudio().use { studio ->
            val live = capture(studio.url)
            live.started("a", Any(), "Never completes", nothingYet)
            live.started("b", Any(), "Another report's", nothingYet)
            live.written("a")
            assertEquals(1, live.runningCount)
            live.written("b")
            assertEquals(0, live.runningCount)
        }
    }

    @Test
    fun `a scenario whose stream stops is let go of`() {
        val closedPort = ServerSocket(0).use { it.localPort }
        val live = capture("ws://127.0.0.1:$closedPort/ws/captures")
        live.started("a", Any(), "Unreachable", nothingYet)
        val deadline = System.nanoTime() + 30_000_000_000
        while (live.runningCount > 0 && System.nanoTime() < deadline) Thread.sleep(10)
        assertEquals(0, live.runningCount)
    }

    @Test
    fun `a scenario that starts on a stream that has already stopped is let go of at once`() {
        TestStudio(TestStudio.Mode.UNSUPPORTED_MAJOR).use { studio ->
            val live = capture(studio.url)
            live.begun("a")
            assertTrue(studio.awaitClosed(30))
            eventually { warnings.isNotEmpty() }
            // Nothing runs on the stream after this, so only started() itself can let it go.
            live.started("a", Any(), "Too late", nothingYet)
            assertEquals(0, live.runningCount, warnings.toString())
        }
    }

    @Test
    fun `a scenario whose stream is dropped for falling behind after it started is let go of`() {
        val entered = CountDownLatch(1)
        val gate = CountDownLatch(1)
        val live = capture("ws://studio", FakeConnector(entered, gate), queueCapacity = 1)
        live.started("a", Any(), "Fell behind", nothingYet)
        // The worker is held in the connect, so the queue (of one) fills and the next send is refused.
        assertTrue(entered.await(30, TimeUnit.SECONDS))
        live.completed("a", Scenario("queued"))
        live.completed("a", Scenario("refused"))
        assertEquals(0, live.runningCount, warnings.toString())
        gate.countDown()
    }

    @Test
    fun `a scenario whose stream LSD Studio closes abnormally is let go of`() {
        val connected = CountDownLatch(1)
        val connector = FakeConnector(connected)
        val live = capture("ws://studio", connector)
        live.started("a", Any(), "Studio went away", nothingYet)
        live.started("a", Any(), "Studio went away too", nothingYet)
        assertTrue(connected.await(30, TimeUnit.SECONDS))
        assertEquals(2, live.runningCount)
        connector.close(1011)
        assertEquals(0, live.runningCount)
    }

    @Test
    fun `a scenario whose report is written while it starts is let go of`() {
        // LSD Studio never closes, so written() leaves the stream unbroken: only its closed flag says so.
        val live = capture("ws://studio", FakeConnector(), flushTimeout = Duration.ofMillis(100))
        live.begun("a")
        live.afterStreamLookup = {
            live.afterStreamLookup = {}
            live.written("a")
        }
        live.started("a", Any(), "Written as it starts", nothingYet)
        assertEquals(0, live.runningCount)
    }
}
