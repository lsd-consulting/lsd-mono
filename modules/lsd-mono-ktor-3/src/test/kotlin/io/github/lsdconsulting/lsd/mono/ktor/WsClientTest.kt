package io.github.lsdconsulting.lsd.mono.ktor

import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.arrow
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.lsd
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.nameOf
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.report
import io.github.lsdconsulting.lsd.mono.ktor.Scenarios.start
import io.github.lsdconsulting.lsd.mono.ktor.fixture.LivePrices.prices
import io.github.lsdconsulting.lsd.mono.ktor.fixture.PriceChanged
import io.github.lsdconsulting.lsd.mono.ktor.fixture.PriceMessages
import io.github.lsdconsulting.lsd.mono.ktor.fixture.Subscribe
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSocketException
import io.ktor.client.plugins.websocket.receiveDeserialized
import io.ktor.client.plugins.websocket.sendSerialized
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.ktor.server.routing.routing
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.sendSerialized
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.ConnectException
import io.ktor.client.engine.cio.CIO as ClientCIO
import io.ktor.client.plugins.websocket.WebSockets as ClientWebSockets
import io.ktor.server.cio.CIO as ServerCIO

/** The WebSockets an `HttpClient` with [LsdClient] opens: drawn by the server plugin when it has one, else by the client. */
@LsdTestConfig(deterministicIds = true)
class WsClientTest {
    private val servers = mutableListOf<EmbeddedServer<*, *>>()

    @BeforeEach
    @AfterEach
    fun clear() {
        servers.forEach { it.stop(0, 0) }
        servers.clear()
        lsd.clear()
    }

    private fun ApplicationTestBuilder.sockets(caller: String = LsdKtor.DEFAULT_CLIENT) =
        createClient {
            install(LsdClient) {
                target = "Prices"
                this.caller = caller
            }
            install(ClientWebSockets) { contentConverter = PriceMessages.converter }
        }

    private suspend fun DefaultClientWebSocketSession.subscribe(ticks: Int = 2) {
        sendSerialized(Subscribe("lamp-01", ticks))
        repeat(ticks) { receiveDeserialized<PriceChanged>() }
        close(CloseReason(CloseReason.Codes.NORMAL, "done"))
    }

    private suspend fun CompletableDeferred<Unit>.waited() = withTimeout(5_000) { await() }

    private val subscribed = listOf("GET /prices", "101 Switching Protocols", "Subscribe", "PriceChanged", "PriceChanged", "close 1000 done")

    @Test
    fun `a socket to an app with the server plugin is drawn once, by the server`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            application { prices(ended = ended) }
            sockets(caller = "Shop").webSocket("/prices") { subscribe() }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals(subscribed, drawn.labels, drawn.json)
        assertEquals("Shop -> Prices", drawn.arrow(drawn.message("Subscribe")))
    }

    @Test
    fun `a socket to an app without it is drawn by the client, to its target`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            application { prices(app = null, ended = ended) }
            sockets().webSocket("/prices") { subscribe() }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals(subscribed, drawn.labels, drawn.json)
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("GET /prices")))
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("101 Switching Protocols")))
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("Subscribe")))
        assertEquals("Prices -> Client", drawn.arrow(drawn.messages.first { it["label"] == "PriceChanged" }))
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("close 1000 done")))
    }

    /** A feed with no server plugin that sends one price and closes. */
    private fun Application.oneShot() {
        install(WebSockets) { contentConverter = PriceMessages.converter }
        routing {
            webSocket("/once") {
                sendSerialized(PriceChanged("lamp-01", 4900))
                close(CloseReason(4000, "sold out"))
            }
        }
    }

    @Test
    fun `a close from the far end, and a capped socket, are drawn by the client`() {
        val scenario = start()
        testApplication {
            application { oneShot() }
            val client =
                createClient {
                    install(LsdClient) {
                        target = "Prices"
                        messagesShown = 0
                    }
                    install(ClientWebSockets) { contentConverter = PriceMessages.converter }
                }
            client.webSocket("/once") {
                assertEquals(PriceChanged("lamp-01", 4900), receiveDeserialized<PriceChanged>())
                for (frame in incoming) {
                    // Until it closes.
                }
            }
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /once", "101 Switching Protocols", "close 4000 sold out"), drawn.labels, drawn.json)
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("close 4000 sold out")))
        assertTrue(
            drawn
                .eventsOf("note")
                .single()
                .source
                .contains("1 more WebSocket message not drawn"),
        )
    }

    @Test
    fun `a handshake that is refused is drawn as a call`() {
        val scenario = start()
        val port = serve { prices(app = null) }
        realClient().use { client ->
            assertThrows(WebSocketException::class.java) { runBlocking { client.webSocket("ws://localhost:$port/nowhere") { } } }
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /nowhere", "404 Not Found"), drawn.labels, drawn.json)
    }

    private fun serve(module: Application.() -> Unit): Int {
        val server = embeddedServer(ServerCIO, port = 0, module = module).start(wait = false)
        servers += server
        return runBlocking {
            server.engine
                .resolvedConnectors()
                .first()
                .port
        }
    }

    private fun realClient(): HttpClient =
        HttpClient(ClientCIO) {
            install(LsdClient)
            install(ClientWebSockets) { contentConverter = PriceMessages.converter }
        }

    @Test
    fun `over a real socket the server plugin draws it once, labelled with its classes`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        val port = serve { prices(ended = ended) }
        realClient().use { client ->
            runBlocking {
                client.webSocket("ws://localhost:$port/prices") { subscribe() }
                ended.waited()
            }
        }

        val drawn = report(scenario)
        assertEquals(subscribed, drawn.labels, drawn.json)
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("Subscribe")))
    }

    @Test
    fun `over a real socket to an app without the plugin the client draws it, to host and port`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        val port = serve { prices(app = null, ended = ended) }
        realClient().use { client ->
            runBlocking {
                client.webSocket("ws://localhost:$port/prices") { subscribe() }
                ended.waited()
            }
        }

        val drawn = report(scenario)
        assertEquals(subscribed, drawn.labels, drawn.json)
        assertEquals("localhost:$port", drawn.nameOf(drawn.message("Subscribe")["to"]))
    }

    @Test
    fun `a socket that cannot connect is drawn as the call and its error, once`() {
        val scenario = start()
        realClient().use { client ->
            assertThrows(ConnectException::class.java) { runBlocking { client.webSocket("ws://127.0.0.1:1/prices") { } } }
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "ConnectException"), drawn.labels, drawn.json)
    }

    @Test
    fun `bytes written from two classes keep the default label`() {
        val both = Frame.Text("{ }")
        MessageNames.record(both, Ping())
        MessageNames.record(both, Ping())
        assertEquals("Ping", MessageNames.of(both))
        MessageNames.record(both, Pong())
        assertNull(MessageNames.of(both))
        MessageNames.record(both, Ping())
        assertNull(MessageNames.of(both), "still ambiguous")
    }

    @Test
    fun `text and binary with the same bytes are named apart`() {
        val text = Frame.Text("same bytes")
        val binary = Frame.Binary(true, "same bytes".toByteArray())
        MessageNames.record(text, Ping())
        assertNull(MessageNames.of(binary))
        MessageNames.record(binary, Pong())
        assertEquals("Ping", MessageNames.of(text))
        assertEquals("Pong", MessageNames.of(binary))
    }

    @Test
    fun `messages up to the size limit are named`() {
        val largest = Frame.Text("x".repeat(MessageNames.MAX_BYTES))
        val over = Frame.Text("y".repeat(MessageNames.MAX_BYTES + 1))
        MessageNames.record(largest, Ping())
        MessageNames.record(over, Ping())
        assertEquals("Ping", MessageNames.of(largest))
        assertNull(MessageNames.of(over))
    }

    @Test
    fun `only the most recently used names are kept`() {
        val first = Frame.Text("eviction first")
        MessageNames.record(first, Ping())
        repeat(MessageNames.MAX_ENTRIES - 1) { MessageNames.record(Frame.Text("eviction filler $it"), Pong()) }
        assertEquals("Ping", MessageNames.of(first), "a full table keeps them all")
        MessageNames.record(Frame.Text("eviction one more"), Pong())
        assertNull(MessageNames.of(Frame.Text("eviction filler 0")), "the least recently used goes")
        assertEquals("Ping", MessageNames.of(first), "a name looked up is kept")
    }

    @Test
    fun `only the app's own classes name a message`() {
        MessageNames.record(Frame.Text("plain words"), "plain words")
        assertNull(MessageNames.of(Frame.Text("plain words")))
        MessageNames.record(Frame.Text("nothing"), null)
        assertNull(MessageNames.of(Frame.Text("nothing")))
        assertNull(MessageNames.nameOf(object {}.javaClass))
        assertNull(MessageNames.nameOf(listOf(1)::class.java))
        assertEquals("PriceChanged", MessageNames.nameOf(PriceChanged::class.java))
        runBlocking {
            val frame = PriceMessages.converter.serialize(
                Charsets.UTF_8,
                io.ktor.util.reflect
                    .typeInfo<PriceChanged>(),
                PriceChanged("a", 1),
            )
            assertEquals("PriceChanged", MessageNames.of(frame))
            assertTrue(PriceMessages.converter.isApplicable(frame))
            assertEquals(
                PriceChanged("a", 1),
                PriceMessages.converter.deserialize(
                    Charsets.UTF_8,
                    io.ktor.util.reflect
                        .typeInfo<PriceChanged>(),
                    frame,
                ),
            )
        }
    }
}

private class Ping

private class Pong
