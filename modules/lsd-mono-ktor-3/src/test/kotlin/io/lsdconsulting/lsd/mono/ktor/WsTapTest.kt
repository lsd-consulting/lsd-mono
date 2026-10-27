package io.lsdconsulting.lsd.mono.ktor

import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketExtension
import io.ktor.websocket.WebSocketSession
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.ktor.Scenarios.arrow
import io.lsdconsulting.lsd.mono.ktor.Scenarios.lsd
import io.lsdconsulting.lsd.mono.ktor.Scenarios.report
import io.lsdconsulting.lsd.mono.ktor.Scenarios.start
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException
import kotlin.coroutines.CoroutineContext

/** Every way an app reads or writes a tapped socket draws the same frames, and a socket that ends without a close is drawn as dropped. */
@LsdTestConfig(deterministicIds = true)
class WsTapTest {
    @BeforeEach
    @AfterEach
    fun clear() = lsd.clear()

    /** A raw session whose frames the test feeds and reads. */
    private class Raw : WebSocketSession {
        val inbox = Channel<Frame>(16)
        val sent = Channel<Frame>(16)
        override val coroutineContext: CoroutineContext = Job()
        override var masking: Boolean = false
        override var maxFrameSize: Long = Long.MAX_VALUE
        override val incoming: ReceiveChannel<Frame> get() = inbox
        override val outgoing: SendChannel<Frame> get() = sent
        override val extensions: List<WebSocketExtension<*>> get() = emptyList()

        override suspend fun flush() = Unit

        @Deprecated("Use cancel() instead.", ReplaceWith("cancel()", "kotlinx.coroutines.cancel"))
        override fun terminate() = Unit
    }

    private val dropped = "close 1006 closed without a close frame"

    private fun tapped(
        raw: Raw,
        test: suspend (WebSocketSession) -> Unit,
    ) = runBlocking {
        val scenario = start()
        test(WsTap(WsDrawing(scenario, "App", 20), "App", "Client").wrap(raw))
        report(scenario)
    }

    @Test
    fun `frames sent with trySend and read with receiveCatching are drawn, pings are not`() {
        val raw = Raw()
        val drawn =
            tapped(raw) { session ->
                assertTrue(session.outgoing.trySend(Frame.Text("hello")).isSuccess)
                assertTrue(session.outgoing.trySend(Frame.Ping(ByteArray(0))).isSuccess)
                session.send(Frame.Binary(true, ByteArray(2)))
                raw.inbox.send(Frame.Text("hi"))
                raw.inbox.close()
                assertEquals("hi", (session.incoming.receiveCatching().getOrNull() as Frame.Text).data.decodeToString())
                assertTrue(session.incoming.receiveCatching().isClosed)
            }
        assertEquals(listOf("text message", "binary (2 bytes)", "text message", dropped), drawn.labels, drawn.json)
        assertEquals("Client -> App", drawn.arrow(drawn.message(dropped)))
        assertEquals(3, generateSequence { raw.sent.tryReceive().getOrNull() }.count())
    }

    @Test
    fun `a socket that fails under receive is drawn as the error and a drop, from the far end`() {
        val raw = Raw()
        val drawn =
            tapped(raw) { session ->
                raw.inbox.send(Frame.Binary(true, ByteArray(4)))
                raw.inbox.close(IOException("connection reset"))
                session.incoming.receive()
                assertThrows(IOException::class.java) { runBlocking { session.incoming.receive() } }
            }
        assertEquals(listOf("binary (4 bytes)", "IOException", dropped), drawn.labels, drawn.json)
        assertEquals("Client -> App", drawn.arrow(drawn.message("IOException")))
    }

    @Test
    fun `a socket that ends under receive is drawn as a drop, with no error`() {
        val raw = Raw()
        val drawn =
            tapped(raw) { session ->
                raw.inbox.close()
                assertThrows(ClosedReceiveChannelException::class.java) { runBlocking { session.incoming.receive() } }
            }
        assertEquals(listOf(dropped), drawn.labels, drawn.json)
    }

    @Test
    fun `nothing is drawn after the close, not frames, errors, a failure or an end`() {
        val drawn =
            runBlocking {
                val scenario = start()
                val drawing = WsDrawing(scenario, "App", 20)
                val tap = WsTap(drawing, "App", "Client")
                tap.inbound(Frame.Close(CloseReason(1000, "bye")))
                tap.inbound(Frame.Text("late"))
                tap.outbound(Frame.Binary(true, ByteArray(1)))
                drawing.error("App", "Client", IllegalStateException("late"))
                tap.failed(IllegalStateException("late"))
                tap.ended(IOException("late"))
                report(scenario)
            }
        assertEquals(listOf("close 1000 bye"), drawn.labels, drawn.json)
    }

    @Test
    fun `a handler cancelled, or one whose socket closed under it, draws no error`() {
        val drawn =
            runBlocking {
                val scenario = start()
                WsTap(WsDrawing(scenario, "App", 20), "App", "Client").apply {
                    failed(kotlinx.coroutines.CancellationException("gone"))
                    failed(ClosedReceiveChannelException("closed"))
                }
                report(scenario)
            }
        assertEquals(emptyList<String>(), drawn.labels, drawn.json)
    }

    @Test
    fun `a handler that fails is drawn as the error and a drop, from the app`() {
        val drawn =
            runBlocking {
                val scenario = start()
                WsTap(WsDrawing(scenario, "App", 20), "App", "Client").failed(IllegalStateException("boom"))
                report(scenario)
            }
        assertEquals(listOf("IllegalStateException", dropped), drawn.labels, drawn.json)
        assertEquals("App -> Client", drawn.arrow(drawn.message("IllegalStateException")))
    }

    @Test
    fun `a frame trySend could not send is not drawn`() {
        val raw = Raw()
        val drawn =
            tapped(raw) { session ->
                raw.sent.close()
                assertTrue(session.outgoing.trySend(Frame.Text("lost")).isFailure)
            }
        assertEquals(emptyList<String>(), drawn.labels, drawn.json)
    }

    @Test
    fun `frames read with tryReceive are drawn, and its end`() {
        val raw = Raw()
        val drawn =
            tapped(raw) { session ->
                raw.inbox.send(Frame.Text("one"))
                raw.inbox.close()
                assertTrue(session.incoming.tryReceive().isSuccess)
                assertTrue(session.incoming.tryReceive().isClosed)
            }
        assertEquals(listOf("text message", dropped), drawn.labels, drawn.json)
    }
}
