package io.lsdconsulting.lsd.mono.ktor

import io.ktor.client.plugins.websocket.receiveDeserialized
import io.ktor.client.plugins.websocket.sendSerialized
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.get
import io.ktor.http.ContentType
import io.ktor.server.application.install
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.webSocket
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.ktor.Scenarios.arrow
import io.lsdconsulting.lsd.mono.ktor.Scenarios.body
import io.lsdconsulting.lsd.mono.ktor.Scenarios.lsd
import io.lsdconsulting.lsd.mono.ktor.Scenarios.report
import io.lsdconsulting.lsd.mono.ktor.Scenarios.start
import io.lsdconsulting.lsd.mono.ktor.fixture.LivePrices.prices
import io.lsdconsulting.lsd.mono.ktor.fixture.PriceChanged
import io.lsdconsulting.lsd.mono.ktor.fixture.PriceMessages
import io.lsdconsulting.lsd.mono.ktor.fixture.Subscribe
import io.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import io.ktor.client.plugins.websocket.WebSockets as ClientWebSockets

/** The WebSockets an app serves with the server plugin, drawn from the handshake to the close. */
@LsdTestConfig(deterministicIds = true)
class WebSocketTest {
    @BeforeEach
    @AfterEach
    fun clear() = lsd.clear()

    private fun ApplicationTestBuilder.sockets() = createClient { install(ClientWebSockets) { contentConverter = PriceMessages.converter } }

    /** Waits for the app's handler to see the close, so it is drawn before the test reads the report. */
    private suspend fun CompletableDeferred<Unit>.waited() = withTimeout(5_000) { await() }

    @Test
    fun `the handshake is drawn as a call, then each message labelled with its class, the app's calls and the close`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            externalServices {
                hosts("http://inventory") {
                    routing { get("/stock/{sku}") { call.respondText("""{"available":true}""", ContentType.Application.Json) } }
                }
            }
            val stock = createClient { install(LsdClient) { target = "Inventory" } }
            application { prices(stock = stock, ended = ended) }
            sockets().webSocket("/prices") {
                sendSerialized(Subscribe("lamp-01"))
                assertEquals(PriceChanged("lamp-01", 4900), receiveDeserialized<PriceChanged>())
                assertEquals(PriceChanged("lamp-01", 4925), receiveDeserialized<PriceChanged>())
                close(CloseReason(CloseReason.Codes.NORMAL, "done"))
            }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals(
            listOf("GET /prices", "101 Switching Protocols", "Subscribe", "GET /stock/lamp-01", "200 OK", "PriceChanged", "PriceChanged", "close 1000 done"),
            drawn.labels,
            drawn.json,
        )
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("GET /prices")))
        assertEquals("Prices -> Client", drawn.arrow(drawn.message("101 Switching Protocols")))
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("Subscribe")))
        assertEquals("Prices -> Inventory", drawn.arrow(drawn.message("GET /stock/lamp-01")))
        assertEquals("Client -> Prices", drawn.arrow(drawn.message("close 1000 done")))
        val prices = drawn.messages.filter { it["label"] == "PriceChanged" }
        assertEquals(listOf("Prices -> Client", "Prices -> Client"), prices.map { drawn.arrow(it) })
        assertEquals(4900L, ((prices[0].body() as JsonObject)["pence"] as Number).toLong(), "the message is in the popup: ${drawn.json}")
        assertEquals("lamp-01", (drawn.message("Subscribe").body() as JsonObject)["sku"], drawn.json)
    }

    @Test
    fun `a chatty socket draws the first messages and counts the rest in a note`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            application { prices(shown = 3, ended = ended) }
            sockets().webSocket("/prices") {
                sendSerialized(Subscribe("desk-02", ticks = 10))
                repeat(10) { receiveDeserialized<PriceChanged>() }
                close(CloseReason(CloseReason.Codes.NORMAL, ""))
            }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals(
            listOf("GET /prices", "101 Switching Protocols", "Subscribe", "PriceChanged", "PriceChanged", "close 1000 NORMAL"),
            drawn.labels,
            drawn.json,
        )
        val note = drawn.eventsOf("note").single()
        assertTrue(note.source.contains("8 more WebSocket messages not drawn"), note.source)
    }

    @Test
    fun `a socket that draws no messages still draws its handshake and close`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            application { prices(shown = 0, ended = ended) }
            sockets().webSocket("/prices") {
                sendSerialized(Subscribe("desk-02", ticks = 1))
                receiveDeserialized<PriceChanged>()
                close(CloseReason(CloseReason.Codes.GOING_AWAY, "bye"))
            }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /prices", "101 Switching Protocols", "close 1001 bye"), drawn.labels, drawn.json)
        assertTrue(
            drawn
                .eventsOf("note")
                .single()
                .source
                .contains("2 more WebSocket messages not drawn"),
        )
    }

    /** Echoes text as `echo`, binary as three bytes, then closes; `fail` fails the handler. */
    private fun ApplicationTestBuilder.echo(ended: CompletableDeferred<Unit>) =
        application {
            install(WebSockets)
            install(Lsd) { app = "Echo" }
            routing {
                webSocket("/echo") {
                    try {
                        when (val frame = incoming.receive()) {
                            is Frame.Text ->
                                when (frame.readText()) {
                                    "fail" -> throw IllegalStateException("feed down")
                                    "big" -> send(Frame.Text("x".repeat(Bodies.LIMIT + 1)))
                                    else -> send(Frame.Text("echo"))
                                }
                            else -> send(Frame.Binary(true, ByteArray(3)))
                        }
                        close(CloseReason(4000, "bye"))
                    } finally {
                        ended.complete(Unit)
                    }
                }
            }
        }

    @Test
    fun `binary messages and a close from the app are drawn`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            echo(ended)
            client.config { install(ClientWebSockets) }.webSocket("/echo") {
                send(Frame.Binary(true, ByteArray(5)))
                assertEquals(3, (incoming.receive() as Frame.Binary).data.size)
                for (frame in incoming) {
                    // Until the app closes.
                }
            }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /echo", "101 Switching Protocols", "binary (5 bytes)", "binary (3 bytes)", "close 4000 bye"), drawn.labels, drawn.json)
        assertEquals("Echo -> Client", drawn.arrow(drawn.message("close 4000 bye")))
        assertEquals(null, drawn.message("binary (5 bytes)").body(), "bytes are not shown")
    }

    @Test
    fun `a text message too large to show is summarised`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            echo(ended)
            client.config { install(ClientWebSockets) }.webSocket("/echo") {
                send(Frame.Text("big"))
                incoming.receive()
                for (frame in incoming) {
                    // Until the app closes.
                }
            }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /echo", "101 Switching Protocols", "text message", "text message", "close 4000 bye"), drawn.labels, drawn.json)
        val big = drawn.messages.filter { it["label"] == "text message" }[1]
        assertEquals("big", drawn.messages.filter { it["label"] == "text message" }[0].body(), drawn.json)
        assertEquals("larger than 256 KiB", (big.body() as JsonObject)["notShown"], drawn.json)
    }

    @Test
    fun `a handler that fails is drawn as an error and the socket's end, once`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            echo(ended)
            client.config { install(ClientWebSockets) }.webSocket("/echo") {
                send(Frame.Text("fail"))
                for (frame in incoming) {
                    // Until the socket ends.
                }
            }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals("GET /echo", drawn.labels[0], drawn.json)
        assertEquals("text message", drawn.labels[2], drawn.json)
        assertEquals(1, drawn.labels.count { it.startsWith("close") }, drawn.json)
        assertTrue(drawn.labels.size <= 5, drawn.json)
    }

    @Test
    fun `a message sent in fragments is drawn once, from its first`() {
        val scenario = start()
        val ended = CompletableDeferred<Unit>()
        testApplication {
            application {
                install(WebSockets)
                install(Lsd) { app = "Echo" }
                routing {
                    webSocket("/parts") {
                        try {
                            for (frame in incoming) {
                                // Until the client closes.
                            }
                        } finally {
                            ended.complete(Unit)
                        }
                    }
                }
            }
            client.config { install(ClientWebSockets) }.webSocket("/parts") {
                outgoing.send(Frame.Text(false, "one ".toByteArray()))
                outgoing.send(Frame.Text(true, "two".toByteArray()))
                close(CloseReason(CloseReason.Codes.NORMAL, "done"))
            }
            ended.waited()
        }

        val drawn = report(scenario)
        assertEquals(listOf("GET /parts", "101 Switching Protocols", "text message", "close 1000 done"), drawn.labels, drawn.json)
        assertEquals("sent in fragments", (drawn.message("text message").body() as JsonObject)["notShown"], drawn.json)
    }

    @Test
    fun `outside a scenario a socket works and nothing is drawn`() {
        val ended = CompletableDeferred<Unit>()
        testApplication {
            application { prices(ended = ended) }
            sockets().webSocket("/prices") {
                sendSerialized(Subscribe("lamp-01", ticks = 1))
                assertEquals(PriceChanged("lamp-01", 4900), receiveDeserialized<PriceChanged>())
                close(CloseReason(CloseReason.Codes.NORMAL, "done"))
            }
            ended.waited()
        }

        val scenario = start()
        assertEquals(emptyList<String>(), report(scenario).labels)
    }

    @Test
    fun `a plain call to an app with sockets is drawn as before`() {
        val scenario = start()
        testApplication {
            application {
                prices()
                routing { get("/health") { call.respondText("up") } }
            }
            client.get("/health")
        }
        assertEquals(listOf("GET /health", "200 OK"), report(scenario).labels)
    }
}
