package io.github.lsdconsulting.lsd.mono.jvm.live

import io.github.lsdconsulting.lsd.mono.jvm.domain.Scenario
import io.github.lsdconsulting.lsd.mono.jvm.report.ReportJsonMapper
import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.URI
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger

/**
 * How live capture behaves when LSD Studio misbehaves: against [TestStudio]'s failure modes over a
 * real socket, and against a scripted [LiveConnector]. Timeouts are short constructor arguments,
 * so nothing here sleeps for them.
 */
class LiveCaptureFailureTest {
    private val warnings = CopyOnWriteArrayList<String>()
    private val ids = AtomicInteger()
    private val frames =
        LiveFrames(ReportJsonMapper { "id${ids.incrementAndGet()}" }).apply {
            // Warm the report writer up, so its first use is not counted against the short timeouts.
            hello("warm")
            scenario("0", Scenario("warm"))
        }

    private fun eventually(check: () -> Boolean) {
        val deadline = System.nanoTime() + 5_000_000_000
        while (!check() && System.nanoTime() < deadline) Thread.sleep(10)
        assertTrue(check())
    }

    private fun capture(
        url: String?,
        connector: LiveConnector = JdkLiveConnector(SHORT),
        queueCapacity: Int = 100,
    ) = LiveCapture(
        frames,
        url = { url },
        connector = connector,
        flushTimeout = SHORT,
        queueCapacity = queueCapacity,
        keepAlive = Duration.ofMillis(50),
        warn = warnings::add,
    )

    private fun types(studio: TestStudio) = studio.frames.map { (Json.parse(it) as JsonObject).string("type") }

    private fun timed(block: () -> Unit): Long {
        val started = System.nanoTime()
        block()
        return (System.nanoTime() - started) / 1_000_000
    }

    @Test
    fun `a stalled LSD Studio costs one wait, then live capture is off for the run`() {
        TestStudio(TestStudio.Mode.STALLS).use { studio ->
            val live = capture(studio.url)
            live.title("a", "Stalls")
            live.begun("a")
            live.completed("a", Scenario("one"))
            val ms = timed { live.written("a") }
            assertTrue(ms < SHORT.toMillis() * 3, "took ${ms}ms")
            assertTrue(live.off, "off after a timeout")
            assertTrue(warnings.single().contains("live capture is off for this run"), warnings.toString())
            live.begun("b")
            live.written("b")
            assertEquals(1, studio.connections.get(), "no second connection")
        }
    }

    @Test
    fun `a close without stored still finishes the stream without waiting`() {
        TestStudio(TestStudio.Mode.NO_STORED_REPLY).use { studio ->
            val live = capture(studio.url)
            live.begun("a")
            val ms = timed { live.written("a") }
            assertTrue(ms < SHORT.toMillis(), "took ${ms}ms")
            assertFalse(live.off)
            assertEquals(listOf("hello", "report.done"), types(studio))
            assertEquals(emptyList<String>(), warnings)
        }
    }

    @Test
    fun `a 1011 close stops the stream, and nothing more is sent`() {
        TestStudio(TestStudio.Mode.CLOSES_1011).use { studio ->
            val live = capture(studio.url)
            live.begun("a")
            assertTrue(studio.awaitClosed())
            live.completed("a", Scenario("one"))
            val ms = timed { live.written("a") }
            assertTrue(ms < SHORT.toMillis(), "took ${ms}ms")
            assertEquals(listOf("hello"), types(studio))
            assertFalse(live.off)
        }
    }

    @Test
    fun `a non-fatal error is warned about and the stream goes on`() {
        TestStudio(TestStudio.Mode.NON_FATAL_ERROR).use { studio ->
            val live = capture(studio.url)
            live.begun("a")
            live.completed("a", Scenario("one"))
            live.written("a")
            assertEquals(listOf("hello", "scenario.start", "scenario.end", "report.done"), types(studio), warnings.toString())
            assertTrue(warnings.single().contains("refused a message: \"Not a valid hello message.\""), warnings.toString())
            assertFalse(live.off)
            studio.replies.forEach { LiveCaptureTest().assertValidFrame(it) }
        }
    }

    @Test
    fun `an unsupported major stops the stream with a warning`() {
        refusedHello(TestStudio.Mode.UNSUPPORTED_MAJOR)
    }

    @Test
    fun `an error reply to the hello stops the stream with a warning`() {
        refusedHello(TestStudio.Mode.ERROR_REPLY)
    }

    private fun refusedHello(mode: TestStudio.Mode) {
        TestStudio(mode).use { studio ->
            val live = capture(studio.url)
            live.begun("a")
            assertTrue(studio.awaitClosed())
            // The refusal is read on the socket's thread. Until it is, a send can fail first with
            // a plainer warning, so this waits for it: the test is about the refusal's wording.
            eventually { warnings.isNotEmpty() }
            live.completed("a", Scenario("one"))
            val ms = timed { live.written("a") }
            assertTrue(ms < SHORT.toMillis(), "took ${ms}ms")
            assertEquals(listOf("hello"), types(studio))
            assertTrue(warnings.single().contains("refused this sender's protocol version 0.1.0"), warnings.toString())
            studio.replies.forEach { LiveCaptureTest().assertValidFrame(it) }
        }
    }

    @Test
    fun `a send that times out turns live capture off for the run`() {
        val connector = Scripted(onSend = { throw TimeoutException("slow") })
        val live = capture("ws://studio", connector)
        live.begun("a")
        live.written("a")
        assertTrue(live.off)
        assertTrue(warnings.single().contains("timed out"), warnings.toString())
    }

    @Test
    fun `a send that fails for another reason stops only its stream`() {
        val connector = Scripted(onSend = { throw IllegalStateException("broken pipe") })
        val live = capture("ws://studio", connector)
        live.begun("a")
        live.written("a")
        assertFalse(live.off, warnings.toString())
        live.begun("b")
        live.written("b")
        assertEquals(2, connector.connects.get())
    }

    @Test
    fun `stored lets written return, and the flush timeout closes a silent socket`() {
        val answering = Scripted(onSend = { frame, script -> if (frame == LiveFrames.DONE) script.reply("""{"type":"stored","reportId":"r"}""") })
        capture("ws://studio", answering).run {
            begun("a")
            val ms = timed { written("a") }
            assertTrue(ms < SHORT.toMillis(), "took ${ms}ms")
            assertFalse(off)
        }
        assertEquals(listOf("hello", "report.done"), answering.sent.map { (Json.parse(it) as JsonObject).string("type") })
        assertEquals(0, answering.closes.get())

        val silent = Scripted()
        capture("ws://studio", silent).run {
            begun("a")
            written("a")
            assertTrue(off)
        }
        eventually { silent.closes.get() == 1 }
    }

    @Test
    fun `a full queue stops that stream at once, by aborting its socket, and the worker exits`() {
        val release = CountDownLatch(1)
        val sending = CountDownLatch(1)
        val connector =
            Scripted(onSend = { _, _ ->
                sending.countDown()
                release.await(5, TimeUnit.SECONDS)
            })
        val live = capture("ws://studio", connector, queueCapacity = 1)
        live.begun("a")
        assertTrue(sending.await(5, TimeUnit.SECONDS), "the worker is busy sending a's hello")
        live.begun("b")
        val ms = timed { live.written("a") }
        assertTrue(ms < SHORT.toMillis(), "the overflow does not block: ${ms}ms")
        assertEquals(1, connector.aborts.get())
        assertEquals(0, connector.closes.get())
        assertTrue(warnings.single().contains("not keeping up"), warnings.toString())
        release.countDown()
        eventually { live.workerThreads == 0 }
        assertTrue(connector.threads.all { it.isDaemon && it.name == "lsd-studio-live" }, "the worker is a daemon")
    }

    @Test
    fun `with no URL nothing connects and no worker thread starts`() {
        val connector = Scripted()
        val live = capture(null, connector)
        live.title("a", "Quiet")
        live.begun("a")
        live.completed("a", Scenario("one"))
        live.written("a")
        assertEquals(0, connector.connects.get())
        assertEquals(0, live.mostWorkerThreads)
    }

    @Test
    fun `a URL that is not ws or wss never connects`() {
        val connector = Scripted()
        val live = capture("http://studio/", connector)
        live.begun("a")
        live.written("a")
        assertEquals(0, connector.connects.get())
        assertTrue(warnings.single().contains("is not a ws:// or wss:// URL"), warnings.toString())
    }

    @Test
    fun `the hello has the title set before the stream opened, not one set after`() {
        val connector = Scripted(onSend = { frame, script -> if (frame == LiveFrames.DONE) script.reply("""{"type":"stored"}""") })
        val gate = CountDownLatch(1)
        val first = AtomicInteger()
        // The first stream's connect holds the worker, so the second's open waits in the queue.
        val blocking =
            LiveConnector { uri, onText, onClose ->
                if (first.getAndIncrement() == 0) gate.await(5, TimeUnit.SECONDS)
                connector.connect(uri, onText, onClose)
            }
        val live = capture("ws://studio", blocking)
        live.begun("z")
        live.title("a", "First")
        live.begun("a")
        live.title("a", "Second")
        gate.countDown()
        live.written("a")
        val titles = connector.sent
            .map { Json.parse(it) as JsonObject }
            .filter { it.string("type") == "hello" }
            .map { it.string("title") }
        assertEquals(listOf(null, "First"), titles)
    }

    /** A connector that runs [onSend] for each frame, and counts connects, closes and aborts. */
    private class Scripted(
        private val onSend: (String, Scripted) -> Unit = { _, _ -> },
    ) : LiveConnector {
        constructor(onSend: () -> Unit) : this({ _, _ -> onSend() })

        val sent = CopyOnWriteArrayList<String>()
        val threads = CopyOnWriteArrayList<Thread>()
        val connects = AtomicInteger()
        val closes = AtomicInteger()
        val aborts = AtomicInteger()
        private var onText: (String) -> Unit = {}
        private var onClose: (Int) -> Unit = {}

        fun reply(text: String) = onText(text)

        override fun connect(
            uri: URI,
            onText: (String) -> Unit,
            onClose: (Int) -> Unit,
        ): LiveSocket {
            connects.incrementAndGet()
            this.onText = onText
            this.onClose = onClose
            return object : LiveSocket {
                override fun send(text: String) {
                    threads.add(Thread.currentThread())
                    sent.add(text)
                    onSend(text, this@Scripted)
                }

                override fun close() {
                    closes.incrementAndGet()
                }

                override fun abort() {
                    aborts.incrementAndGet()
                }
            }
        }
    }

    private companion object {
        // Long enough for a loaded CI runner to connect and answer, short enough to wait out.
        val SHORT: Duration = Duration.ofMillis(3_000)
    }
}
